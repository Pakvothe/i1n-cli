import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Wording } from "./types.js";

/**
 * Push state v2 — per-language baseline tracking.
 *
 * The v1 file (per-wording MD5 hash of the entire value_json) couldn't
 * distinguish a stale local copy from a true local edit, and falsely
 * marked any wording as "changed" whenever the local file omitted a
 * language the server had. This v2 layout stores the exact per-language
 * values the CLI last synced, plus the server's `updated_at`, so:
 *
 *   1. `i1n push` can compute a per-(key, lang) three-way diff between
 *      Local, Server, and this Push state baseline (P), making
 *      "stale local" vs "real local edit" distinguishable.
 *   2. The per-key `updated_at` is forwarded to the server as
 *      `expected_updated_at`, enabling server-side optimistic concurrency.
 *
 * The file lives at `<localesDir>/.i1n-push-state.json` and is
 * gitignored — it's working-tree metadata, not a source artifact.
 */

const STATE_FILE = ".i1n-push-state.json";

export interface PushStateEntry {
  /** Per-language values as of the last sync (push or pull). */
  values: Record<string, string>;
  /** Server `updated_at` (ISO-8601) as of the last sync. May be absent
   * for entries persisted by a v3.0 client talking to a v2 server that
   * didn't yet expose `updated_at`. */
  updated_at?: string;
}

export interface PushStateV2 {
  version: 2;
  wordings: Record<string /* "ns:key" */, PushStateEntry>;
}

const EMPTY_STATE: PushStateV2 = { version: 2, wordings: {} };

function statePath(localesDir: string): string {
  return path.join(localesDir, STATE_FILE);
}

function entryKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/**
 * Read state. Returns empty v2 if file missing, malformed, or v1.
 * v1 detection: top-level shape is `Record<string, string>` (md5 hashes)
 * with no `version` field. We can't recover per-lang values from hashes,
 * so we discard silently and let the caller treat the load as
 * "fresh-checkout" (which falls back to server baseline).
 */
export function readPushState(localesDir: string): PushStateV2 {
  const filePath = statePath(localesDir);
  if (!fs.existsSync(filePath)) return { ...EMPTY_STATE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { ...EMPTY_STATE };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as PushStateV2).version === 2 &&
    typeof (parsed as PushStateV2).wordings === "object" &&
    (parsed as PushStateV2).wordings !== null
  ) {
    return parsed as PushStateV2;
  }

  // v1 or unrecognized — discard so the push falls back to server baseline.
  return { ...EMPTY_STATE };
}

/**
 * Atomic write: tmp + rename. If the process is killed mid-write the
 * destination keeps the previous content rather than a half-written
 * JSON.
 */
export function writePushState(
  state: PushStateV2,
  localesDir: string,
): void {
  const filePath = statePath(localesDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), "utf-8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Cleanup tmp on rename failure (e.g. cross-device on weird FS)
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

// ─── Three-way diff ─────────────────────────────────────────────────

export interface Conflict {
  namespace: string;
  key: string;
  lang: string;
  /** Push-state baseline value (may be undefined when state was synthesized
   * from the server because no v2 state was present). */
  base: string | undefined;
  /** Local file value. */
  local: string;
  /** Server value. */
  server: string;
}

export interface ServerOnlyChange {
  namespace: string;
  key: string;
  lang: string;
  /** New value from the server. */
  value: string;
  /** Previous value the local copy had (undefined if the lang didn't
   * exist locally at all). */
  previous: string | undefined;
}

export interface LocalOnlyChange {
  namespace: string;
  key: string;
  lang: string;
  value: string;
}

export interface LocalDeletion {
  namespace: string;
  key: string;
  lang: string;
  /** Value the server still has for this lang. */
  serverValue: string;
}

export interface DiffResult {
  /** Per-(key, lang) values the user wants to push. */
  toPush: LocalOnlyChange[];
  /** Per-(key, lang) values where the server is ahead and local has no
   * competing edit — safe to write back to local files. */
  serverOnly: ServerOnlyChange[];
  /** True three-way conflicts: both sides moved off the baseline to
   * different values. The user must resolve. */
  conflicts: Conflict[];
  /** Local-removal candidates: lang was in the baseline + server but
   * absent locally. We do not propagate deletes — the user is warned. */
  localDeletions: LocalDeletion[];
  /** (key, lang) pairs unchanged across all three. */
  unchanged: number;
  /** Whether P was empty and we synthesized it from S. Affects how the
   * caller communicates outcomes (e.g. "fresh checkout" wording). */
  stateWasEmpty: boolean;
}

interface WordingIndex {
  [nsKey: string]: Record<string /* lang */, string>;
}

function indexByKey(wordings: Wording[]): WordingIndex {
  const out: WordingIndex = {};
  for (const w of wordings) {
    const k = entryKey(w.namespace, w.key);
    // Wording.value_json may contain undefined entries from buggy
    // parsers; coerce to a clean Record<string,string>.
    const safe: Record<string, string> = {};
    for (const [lang, val] of Object.entries(w.value_json)) {
      if (typeof val === "string") safe[lang] = val;
    }
    out[k] = safe;
  }
  return out;
}

function indexState(state: PushStateV2): WordingIndex {
  const out: WordingIndex = {};
  for (const [k, entry] of Object.entries(state.wordings)) {
    out[k] = { ...entry.values };
  }
  return out;
}

/**
 * Per-(namespace, key, lang) three-way diff.
 *
 * Semantics per (key, lang):
 *
 *   L === S                        → unchanged
 *   L === P, S !== P (= server)    → server-only edit, auto-pull to local
 *   S === P, L !== P (= local)     → local-only edit, push
 *   L !== P, S !== P, L !== S      → true conflict, resolve
 *   L absent, S present            → local-deletion candidate
 *   L present, S absent, P absent  → fresh local addition, push
 *   L present, S absent, P present → server-side delete (rare).
 *                                    Treat as local-only edit (push the
 *                                    local value to re-create on server).
 *
 * If P is empty (fresh checkout / discarded v1), we synthesize P := S
 * so divergences surface as conflicts that the user can disambiguate.
 */
export function diffThreeWay(
  localWordings: Wording[],
  serverWordings: Wording[],
  pushState: PushStateV2,
): DiffResult {
  const L = indexByKey(localWordings);
  const S = indexByKey(serverWordings);
  const stateWasEmpty = Object.keys(pushState.wordings).length === 0;
  // When P is empty, treat S as baseline. This means any L != S looks
  // like a conflict (since L != P, S == P, L != S — conflict cell),
  // forcing the user to confirm rather than silently overwriting.
  const P = stateWasEmpty ? S : indexState(pushState);

  const toPush: LocalOnlyChange[] = [];
  const serverOnly: ServerOnlyChange[] = [];
  const conflicts: Conflict[] = [];
  const localDeletions: LocalDeletion[] = [];
  let unchanged = 0;

  const allKeys = new Set<string>([
    ...Object.keys(L),
    ...Object.keys(S),
    ...Object.keys(P),
  ]);

  for (const nsKey of allKeys) {
    const [namespace, ...keyParts] = nsKey.split(":");
    const key = keyParts.join(":");

    const Lw = L[nsKey] ?? {};
    const Sw = S[nsKey] ?? {};
    const Pw = P[nsKey] ?? {};

    const allLangs = new Set<string>([
      ...Object.keys(Lw),
      ...Object.keys(Sw),
      ...Object.keys(Pw),
    ]);

    for (const lang of allLangs) {
      const l = Lw[lang];
      const s = Sw[lang];
      const p = Pw[lang];

      // Both absent — nothing to do.
      if (l === undefined && s === undefined) continue;

      // Lang exists nowhere on the server side (and we know about it
      // locally) → local addition, push it.
      if (s === undefined) {
        if (l !== undefined) {
          toPush.push({ namespace, key, lang, value: l });
        }
        continue;
      }

      // Lang absent locally but present on server.
      if (l === undefined) {
        if (p === undefined) {
          // Server has a lang we never knew about → bring in.
          serverOnly.push({
            namespace, key, lang, value: s, previous: undefined,
          });
        } else if (!stateWasEmpty && p === s) {
          // We knew this lang existed and didn't touch it locally
          // (file might not have been re-exported). Treat as deletion
          // candidate — warn and DO NOT propagate (no delete verb).
          //
          // The `!stateWasEmpty` guard is critical: when P was
          // synthesized from S, `p === s` is true for every lang the
          // server has, so without this guard every absent-local lang
          // would be misreported as a deletion on a fresh checkout.
          localDeletions.push({ namespace, key, lang, serverValue: s });
        } else {
          // Server changed it AND we lost it locally, OR baseline was
          // synthesized: bring it in (do not propagate an ambiguous
          // local delete).
          serverOnly.push({
            namespace, key, lang, value: s, previous: p,
          });
        }
        continue;
      }

      // Both sides present.
      if (l === s) {
        unchanged++;
        continue;
      }
      // When the baseline was synthesized from the server (stateWasEmpty),
      // we cannot tell a true local edit from a stale local copy — both
      // satisfy "S == P, L != P" because P == S by construction. Treat
      // every divergence as a conflict so the user has to disambiguate.
      if (stateWasEmpty) {
        conflicts.push({ namespace, key, lang, base: undefined, local: l, server: s });
        continue;
      }
      if (l === p) {
        // Local matches baseline; server has moved.
        serverOnly.push({ namespace, key, lang, value: s, previous: p });
        continue;
      }
      if (s === p) {
        // Server matches baseline; user has edited.
        toPush.push({ namespace, key, lang, value: l });
        continue;
      }
      // Both moved off the baseline, to different values.
      conflicts.push({ namespace, key, lang, base: p, local: l, server: s });
    }
  }

  return {
    toPush,
    serverOnly,
    conflicts,
    localDeletions,
    unchanged,
    stateWasEmpty,
  };
}

/**
 * Build the next state file from the prior state, the server response,
 * and the items the current push actually committed.
 *
 * Strategy:
 *   - Start from `serverWordings` as the baseline (these are the
 *     canonical values right after pull).
 *   - Overlay the values that the CLI just pushed (we don't have a
 *     post-push snapshot but per-lang merge semantics guarantee these
 *     are now the server's values for those langs).
 *   - Carry server `updated_at` per key.
 *
 * Items in `serverConflicts` are left in their prior state — the user
 * resolved them through the interactive loop and the resolution either
 * went into `pushed` or was an explicit "accept server"; either way
 * those keys are represented in `serverWordings` or `pushed`.
 */
export function buildNextState(
  serverWordings: Wording[],
  pushedPerKeyLang: Record<string, Record<string, string>>,
): PushStateV2 {
  const next: PushStateV2 = { version: 2, wordings: {} };

  // Start with server snapshot per (ns, key).
  for (const w of serverWordings) {
    const k = entryKey(w.namespace, w.key);
    const values: Record<string, string> = {};
    for (const [lang, val] of Object.entries(w.value_json)) {
      if (typeof val === "string") values[lang] = val;
    }
    next.wordings[k] = {
      values,
      updated_at: w.updated_at,
    };
  }

  // Overlay pushed langs (which the server now has too).
  for (const [k, langs] of Object.entries(pushedPerKeyLang)) {
    const existing = next.wordings[k] ?? { values: {}, updated_at: undefined };
    for (const [lang, val] of Object.entries(langs)) {
      existing.values[lang] = val;
    }
    next.wordings[k] = existing;
  }

  return next;
}

// ─── Back-compat shims used during the transition ─────────────────────
//
// Older callers (legacy paths that haven't migrated to the three-way
// diff yet) imported these symbol names. They now resolve to no-op /
// v2-aware behavior so we never reintroduce the per-wording-hash bug
// even if a forgotten code path slips through.

/**
 * @deprecated Use `diffThreeWay` instead. This shim returns every
 * wording as "changed" — the same behavior the v1 code exhibited when
 * the state file was missing — but never tries to consult the broken
 * per-wording hash again.
 */
export function getChangedWordings(
  wordings: Wording[],
  _localesDir: string,
): { changed: Wording[]; unchanged: number } {
  return { changed: wordings, unchanged: 0 };
}

/** Temporary directory helper exported for test isolation. */
export function _testTmpDir(prefix = "i1n-push-state-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
