import fs from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import {
  buildNextState,
  diffThreeWay,
  readPushState,
  revertUnappliedServerOnly,
  writePushState,
  type Conflict,
  type DiffResult,
  type ServerOnlyChange,
} from "../../shared/push-state.js";
import { normalizeWordingLanguages } from "../../shared/languages.js";
import {
  contractWordings,
  expandForWrite,
  pushedConstantRewrites,
  staleConstantRefs,
} from "../../shared/constants.js";
import { text, error } from "./helpers.js";
import type {
  PullResponse,
  PushConflict,
  PushResponse,
  Wording,
} from "../../shared/types.js";

/**
 * MCP push tool — mirrors `i1n push` but is always non-interactive.
 *
 * Conflict policy:
 *   - true three-way conflicts → ABORT and surface details in the
 *     response so the AI agent can decide (typically: pull, resolve,
 *     re-push). Never silently overwrites server state.
 *   - server-only changes → auto-pulled to local files (same as CLI).
 *   - local edits → pushed with optimistic-concurrency token.
 *
 * AI agents that need to bias one side can re-invoke after running a
 * pull (server wins) or use the underlying CLI with --strategy ours
 * (local wins, destructive).
 */
export async function handlePush() {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  const localesPath = path.resolve(config.localesDir);
  if (!fs.existsSync(localesPath)) {
    return error(
      `Directory not found: ${config.localesDir}. Update localesDir in i1n.config.json or run \`i1n init\` again.`,
    );
  }

  const parser = getParser(config.format);
  const { wordings, warnings } = parser.read(
    config.localesDir,
    config.sourceLocale,
  );

  if (wordings.length === 0) {
    return text(
      `No translation keys found in ${localesPath}. Check your format setting in i1n.config.json.`,
    );
  }

  let limits;
  try {
    limits = await callCliSync(
      "project-limits",
      { project_id: config.projectId },
      config.apiKey,
    );
  } catch (err) {
    return error(
      err instanceof Error ? err.message : "Could not check project limits",
    );
  }

  if (limits.is_locked) {
    return error(
      "Project is locked (Read-Only). Upgrade your plan to enable pushing translations.",
    );
  }

  const messages: string[] = [];
  const allMappings = new Map<string, string>();
  const allUnsupported = new Set<string>();

  for (const wording of wordings) {
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      wording.value_json,
      limits.supported_codes,
    );
    wording.value_json = normalized;
    for (const [from, to] of mappings) allMappings.set(from, to);
    for (const code of unsupported) allUnsupported.add(code);
  }

  for (const [from, to] of allMappings) {
    messages.push(`Normalized "${from}" → "${to}"`);
  }
  for (const code of allUnsupported) {
    messages.push(`Warning: Unknown language code "${code}". Skipping.`);
  }

  // Apply plan-trim (same as CLI)
  const localLangs = new Set<string>();
  for (const w of wordings) {
    for (const code of Object.keys(w.value_json)) {
      localLangs.add(code);
    }
  }

  const newLangs = [...localLangs].filter(
    (c) => !limits.languages.used.includes(c),
  );
  const exceededLangs = new Set<string>();

  if (newLangs.length > limits.languages.remaining_slots) {
    const allowed = new Set(
      newLangs.slice(0, limits.languages.remaining_slots),
    );
    for (const lang of newLangs) {
      if (!allowed.has(lang)) exceededLangs.add(lang);
    }
    // NOTE: the local mirror (`wordings`) is NOT mutated — it is what gets
    // written back to disk. Exceeded langs are filtered from the payload.
    messages.push(
      `Warning: Language limit reached (${limits.languages.used.length}/${limits.languages.limit}). Skipping: ${[...exceededLangs].join(", ")}.`,
    );
  }

  // New keys beyond the plan's wording capacity are skipped from the payload
  // below (never by truncating the local mirror, which would drop keys from
  // the files on write-back).
  const wordingCapacity = Math.max(0, limits.wordings.limit - limits.wordings.used);

  // ── Three-way diff ─────────────────────────────────────────────────
  const state = readPushState(config.localesDir);
  const stateEmpty = Object.keys(state.wordings).length === 0;

  // Constants (see cli/commands/push.ts for the full rationale).
  const snapshotConstants = state.constants ?? null;
  let currentConstants: Record<string, string> | null = snapshotConstants;
  let currentConstantsHash: string | undefined = state.constants_hash;

  let serverWordings: Wording[] = [];
  let needFullPull = stateEmpty;

  if (!stateEmpty) {
    try {
      const { revisions, constants_hash } = await callCliSync(
        "pull-revisions",
        { project_id: config.projectId },
        config.apiKey,
      );
      const serverKeyMap = new Map<string, string>();
      for (const r of revisions) {
        serverKeyMap.set(`${r.namespace}:${r.key}`, r.updated_at);
      }
      const stateKeys = Object.keys(state.wordings);
      if ((constants_hash ?? "") !== (state.constants_hash ?? "")) {
        needFullPull = true;
      }
      if (serverKeyMap.size !== stateKeys.length) {
        needFullPull = true;
      } else {
        for (const sk of stateKeys) {
          if (state.wordings[sk].updated_at !== serverKeyMap.get(sk)) {
            needFullPull = true;
            break;
          }
        }
      }
    } catch {
      needFullPull = true;
    }
  }

  if (needFullPull) {
    try {
      const pullResult: PullResponse = await callCliSync(
        "pull",
        { project_id: config.projectId, raw_constants: true },
        config.apiKey,
      );
      serverWordings = pullResult.wordings;
      currentConstants = pullResult.constants ?? null;
      currentConstantsHash = pullResult.constants_hash;
    } catch (err) {
      return error(
        err instanceof Error ? err.message : "Could not fetch server state",
      );
    }
  } else {
    serverWordings = Object.entries(state.wordings).map(([nsKey, entry]) => {
      const colonIndex = nsKey.indexOf(":");
      return {
        namespace: nsKey.slice(0, colonIndex),
        key: nsKey.slice(colonIndex + 1),
        value_json: { ...entry.values },
        updated_at: entry.updated_at,
      };
    });
  }

  const baselineValues: Record<string, Record<string, string>> = {};

  for (const [k, entry] of Object.entries(state.wordings)) baselineValues[k] = entry.values;

  const contractedLocal = contractWordings(

    wordings,

    serverWordings,

    baselineValues,

    snapshotConstants,

    currentConstants,

  );

  const diff: DiffResult = diffThreeWay(contractedLocal, serverWordings, state);

  const touched = new Set<string>(

    [...diff.toPush, ...diff.conflicts, ...diff.serverOnly].map(

      (c) => `${c.namespace}:${c.key}:${c.lang}`,

    ),

  );

  for (const st of staleConstantRefs(serverWordings, snapshotConstants, currentConstants)) {

    if (touched.has(`${st.namespace}:${st.key}:${st.lang}`)) continue;

    diff.serverOnly.push({ namespace: st.namespace, key: st.key, lang: st.lang, value: st.value, previous: st.value });

  }

  messages.push(
    `${diff.toPush.length} local edits, ${diff.serverOnly.length} server-only, ${diff.conflicts.length} conflicts, ${diff.unchanged} unchanged.`,
  );

  // Conflicts → abort and surface for the agent to resolve
  if (diff.conflicts.length > 0) {
    messages.push("");
    messages.push(
      `Push aborted: ${diff.conflicts.length} conflict(s) require resolution.`,
    );
    messages.push(
      "Run `i1n pull` to accept server values, or manually edit the conflicting keys to the desired final value and push again.",
    );
    messages.push("Conflicts:");
    const limit = Math.min(diff.conflicts.length, 20);
    for (let i = 0; i < limit; i++) {
      const c: Conflict = diff.conflicts[i];
      messages.push(`  ${c.namespace}.${c.key} [${c.lang}]`);
      if (c.base !== undefined) messages.push(`    base   : ${c.base}`);
      messages.push(`    local  : ${c.local}`);
      messages.push(`    server : ${c.server}`);
    }
    if (diff.conflicts.length > limit) {
      messages.push(`  ...and ${diff.conflicts.length - limit} more`);
    }
    return error(messages.join("\n"));
  }

  // Auto-pull server-only changes. Changes that never reach disk must not
  // advance the state baseline (see revertUnappliedServerOnly), and a mirror
  // built from files that failed to parse must never be written back.
  let serverOnlyUnapplied: ServerOnlyChange[] = [];
  if (diff.serverOnly.length > 0 && warnings.length > 0) {
    serverOnlyUnapplied = diff.serverOnly;
    messages.push(
      `Warning: skipped writing ${diff.serverOnly.length} server-side change(s) to local files because some locale files could not be read. Fix them and run i1n pull.`,
    );
  } else if (diff.serverOnly.length > 0) {
    try {
      const prepared = expandForWrite(diff.serverOnly, currentConstants);
      if (prepared.missing.length > 0) {
        messages.push(
          `Warning: undefined constant(s) ${prepared.missing.map((n) => `{@${n}}`).join(", ")} written as literal markers. Define them in the dashboard (Settings → AI Context → Constants).`,
        );
      }
      applyServerOnlyToLocalFiles(
        prepared.changes,
        wordings,
        config.localesDir,
        parser,
      );
      messages.push(
        `Auto-pulled ${diff.serverOnly.length} server-only change(s) to local files.`,
      );
    } catch (err) {
      serverOnlyUnapplied = diff.serverOnly;
      messages.push(
        `Warning: Could not write server-only updates to disk: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Build push payload (per-lang diffs + expected_updated_at)
  const payloadByKey = new Map<
    string,
    Wording & { expected_updated_at?: string }
  >();
  const serverKeySet = new Set(serverWordings.map((w) => `${w.namespace}:${w.key}`));
  const newKeysAllowed = new Set<string>();
  const skippedNewKeySet = new Set<string>();
  for (const item of diff.toPush) {
    // Empty strings are never pushed (the server skips them; recording
    // them as synced would poison the state baseline).
    if (item.value === "") continue;
    // Plan trims apply to the payload only (the local mirror stays intact).
    if (exceededLangs.has(item.lang)) continue;
    const nsKey = `${item.namespace}:${item.key}`;
    if (!serverKeySet.has(nsKey) && !newKeysAllowed.has(nsKey)) {
      if (newKeysAllowed.size >= wordingCapacity) {
        skippedNewKeySet.add(nsKey);
        continue;
      }
      newKeysAllowed.add(nsKey);
    }
    const k = `${item.namespace}:${item.key}`;
    let w = payloadByKey.get(k);
    if (!w) {
      w = {
        namespace: item.namespace,
        key: item.key,
        value_json: {},
        expected_updated_at: state.wordings[k]?.updated_at,
      };
      payloadByKey.set(k, w);
    }
    w.value_json[item.lang] = item.value;
  }

  const payload = Array.from(payloadByKey.values());
  const pushedPerKeyLang: Record<string, Record<string, string>> = {};
  if (skippedNewKeySet.size > 0) {
    messages.push(
      `Warning: Wording limit reached (${limits.wordings.used}/${limits.wordings.limit}). Skipped ${skippedNewKeySet.size} new key(s); updates to existing keys were pushed.`,
    );
  }

  // Single choke point for state writes: never advance the baseline (nor the
  // constants snapshot) while any file still holds an old expansion — i.e.
  // until server-only write-back and the pushed-values refresh both succeeded.
  let constantsSynced = false;
  const writeStateFile = (pushed: Record<string, Record<string, string>>): void => {
    const constantsInfo =
      constantsSynced && serverOnlyUnapplied.length === 0
        ? { constants: currentConstants, hash: currentConstantsHash }
        : { constants: snapshotConstants, hash: state.constants_hash };
    const next = buildNextState(serverWordings, pushed, constantsInfo);
    revertUnappliedServerOnly(next, serverOnlyUnapplied, state);
    writePushState(next, config.localesDir);
  };

  if (payload.length === 0) {
    // No push needed but advance state to reflect freshly synced baseline.
    constantsSynced = true;
    writeStateFile({});
    if (warnings.length > 0) {
      messages.push("Parse warnings:");
      for (const w of warnings) {
        messages.push(`  ${w.file}: ${w.message}`);
      }
    }
    messages.push("No changes to push.");
    return text(messages.join("\n"));
  }

  const BATCH_SIZE = 500;
  let totalCreated = 0;
  let totalUpdated = 0;
  const serverSideConflicts: PushConflict[] = [];

  try {
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const batch = payload.slice(i, i + BATCH_SIZE);
      const result: PushResponse = await callCliSync(
        "push",
        { project_id: config.projectId, wordings: batch },
        config.apiKey,
      );
      totalCreated += result.created;
      totalUpdated += result.updated;
      if (result.conflicts && result.conflicts.length > 0) {
        serverSideConflicts.push(...result.conflicts);
      }
      if (result.warning) {
        messages.push(`Warning: ${result.warning}`);
      }
      const conflictKeySet = new Set<string>(
        (result.conflicts ?? []).map((c) => `${c.namespace}:${c.key}`),
      );
      for (const w of batch) {
        const k = `${w.namespace}:${w.key}`;
        if (conflictKeySet.has(k)) continue;
        if (!pushedPerKeyLang[k]) pushedPerKeyLang[k] = {};
        for (const [lang, val] of Object.entries(w.value_json)) {
          pushedPerKeyLang[k][lang] = val;
        }
      }
      writeStateFile(pushedPerKeyLang);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : "Push failed");
  }

  // Refresh expansions of pushed values that reference constants (see CLI push).
  const rewrites = pushedConstantRewrites(pushedPerKeyLang);
  if (rewrites.length === 0) {
    constantsSynced = true;
  } else if (warnings.length === 0) {
    try {
      const prepared = expandForWrite(rewrites, currentConstants);
      if (prepared.missing.length > 0) {
        messages.push(
          `Warning: undefined constant(s) ${prepared.missing.map((n) => `{@${n}}`).join(", ")} in pushed values were written as literal markers.`,
        );
      }
      applyServerOnlyToLocalFiles(prepared.changes, wordings, config.localesDir, parser);
      constantsSynced = true;
    } catch (err) {
      messages.push(
        `Warning: could not refresh constant expansions in local files: ${err instanceof Error ? err.message : String(err)}. Run i1n pull.`,
      );
    }
  } else {
    messages.push(
      "Warning: constant expansions in local files were not refreshed because some locale files could not be read. Run i1n pull after fixing them.",
    );
  }
  writeStateFile(pushedPerKeyLang);

  messages.push(
    `Push complete: ${totalCreated} created, ${totalUpdated} updated.`,
  );

  if (serverSideConflicts.length > 0) {
    messages.push(
      `Note: ${serverSideConflicts.length} item(s) were not updated because another writer changed them during this push. Re-run \`i1n push\` to resolve.`,
    );
  }

  if (warnings.length > 0) {
    messages.push("Parse warnings:");
    for (const w of warnings) {
      messages.push(`  ${w.file}: ${w.message}`);
    }
  }

  return text(messages.join("\n"));
}

function applyServerOnlyToLocalFiles(
  serverOnly: ServerOnlyChange[],
  localWordings: Wording[],
  localesDir: string,
  parser: ReturnType<typeof getParser>,
): void {
  if (serverOnly.length === 0) return;

  const localByNsKey = new Map<string, Wording>();
  for (const w of localWordings) {
    localByNsKey.set(`${w.namespace}:${w.key}`, w);
  }

  const affectedNs = new Set<string>();
  const affectedLangs = new Set<string>();

  for (const change of serverOnly) {
    affectedNs.add(change.namespace);
    affectedLangs.add(change.lang);
    const k = `${change.namespace}:${change.key}`;
    let w = localByNsKey.get(k);
    if (!w) {
      w = { namespace: change.namespace, key: change.key, value_json: {} };
      localByNsKey.set(k, w);
      localWordings.push(w);
    }
    w.value_json[change.lang] = change.value;
  }

  const wordingsForWrite = localWordings.filter((w) =>
    affectedNs.has(w.namespace),
  );
  const languagesForWrite = Array.from(affectedLangs).map((code) => ({
    code,
    name: code,
  }));

  parser.write(localesDir, wordingsForWrite, languagesForWrite);
}
