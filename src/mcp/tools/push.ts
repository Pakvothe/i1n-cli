import fs from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import {
  buildNextState,
  diffThreeWay,
  readPushState,
  writePushState,
  type Conflict,
  type DiffResult,
  type ServerOnlyChange,
} from "../../shared/push-state.js";
import { normalizeWordingLanguages } from "../../shared/languages.js";
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
    for (const wording of wordings) {
      for (const lang of exceededLangs) {
        delete wording.value_json[lang];
      }
    }
    messages.push(
      `Warning: Language limit reached (${limits.languages.used.length}/${limits.languages.limit}). Skipping: ${[...exceededLangs].join(", ")}.`,
    );
  }

  const wordingCapacity = limits.wordings.limit - limits.wordings.used;
  if (wordings.length > wordingCapacity && wordingCapacity >= 0) {
    const excess = wordings.length - wordingCapacity;
    wordings.splice(wordingCapacity);
    messages.push(
      `Warning: Wording limit reached (${limits.wordings.used}/${limits.wordings.limit}). Pushing ${wordingCapacity} keys, skipping ${excess}.`,
    );
  }

  if (wordings.length === 0) {
    return text("No keys to push after validation.\n" + messages.join("\n"));
  }

  // ── Three-way diff ─────────────────────────────────────────────────
  const state = readPushState(config.localesDir);
  const stateEmpty = Object.keys(state.wordings).length === 0;

  let serverWordings: Wording[] = [];
  let needFullPull = stateEmpty;

  if (!stateEmpty) {
    try {
      const { revisions } = await callCliSync(
        "pull-revisions",
        { project_id: config.projectId },
        config.apiKey,
      );
      const serverKeyMap = new Map<string, string>();
      for (const r of revisions) {
        serverKeyMap.set(`${r.namespace}:${r.key}`, r.updated_at);
      }
      const stateKeys = Object.keys(state.wordings);
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
        { project_id: config.projectId },
        config.apiKey,
      );
      serverWordings = pullResult.wordings;
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

  const diff: DiffResult = diffThreeWay(wordings, serverWordings, state);

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

  // Auto-pull server-only changes
  if (diff.serverOnly.length > 0) {
    try {
      applyServerOnlyToLocalFiles(
        diff.serverOnly,
        wordings,
        config.localesDir,
        parser,
      );
      messages.push(
        `Auto-pulled ${diff.serverOnly.length} server-only change(s) to local files.`,
      );
    } catch (err) {
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
  for (const item of diff.toPush) {
    // Empty strings are never pushed (the server skips them; recording
    // them as synced would poison the state baseline).
    if (item.value === "") continue;
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

  if (payload.length === 0) {
    // No push needed but advance state to reflect freshly synced baseline.
    const nextState = buildNextState(serverWordings, {});
    writePushState(nextState, config.localesDir);
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
      const partialState = buildNextState(serverWordings, pushedPerKeyLang);
      writePushState(partialState, config.localesDir);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : "Push failed");
  }

  const nextState = buildNextState(serverWordings, pushedPerKeyLang);
  writePushState(nextState, config.localesDir);

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
