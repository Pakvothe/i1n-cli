import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import * as p from "@clack/prompts";
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
  type PushStateEntry,
  type PushStateV2,
  type ServerOnlyChange,
} from "../../shared/push-state.js";
import { normalizeWordingLanguages } from "../../shared/languages.js";
import { executePull } from "./pull.js";
import type {
  EstimateTranslateResponse,
  ProjectLimitsResponse,
  PullResponse,
  PushConflict,
  PushResponse,
  TranslationProgressResponse,
  Wording,
} from "../../shared/types.js";

const MAX_WAIT_MS = 3 * 60 * 1000; // 3 minutes
const MAX_CONSECUTIVE_ERRORS = 10;

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function renderConflicts(conflicts: Conflict[]): void {
  const limit = Math.min(conflicts.length, 10);
  for (let i = 0; i < limit; i++) {
    const c = conflicts[i];
    p.log.info(`  ${c.namespace}.${c.key} [${c.lang}]`);
    if (c.base !== undefined) {
      p.log.info(`    base   : ${truncate(c.base)}`);
    }
    p.log.info(`    local  : ${truncate(c.local)}`);
    p.log.info(`    server : ${truncate(c.server)}`);
  }
  if (conflicts.length > limit) {
    p.log.info(`  ...and ${conflicts.length - limit} more`);
  }
}

type InteractiveResolution =
  | "abort"
  | { localWins: Conflict[]; serverWins: Conflict[] };

async function resolveConflictsInteractive(
  conflicts: Conflict[],
): Promise<InteractiveResolution> {
  const localWins: Conflict[] = [];
  const serverWins: Conflict[] = [];

  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const heading = `Conflict ${i + 1}/${conflicts.length}: ${c.namespace}.${c.key} [${c.lang}]`;
    const choice = await p.select<string>({
      message: heading,
      options: [
        { value: "local", label: `Keep local: "${truncate(c.local, 80)}"` },
        { value: "server", label: `Accept server: "${truncate(c.server, 80)}"` },
        { value: "abort", label: "Abort push" },
      ],
    });
    if (p.isCancel(choice) || choice === "abort") {
      return "abort";
    }
    if (choice === "local") localWins.push(c);
    else if (choice === "server") serverWins.push(c);
  }

  return { localWins, serverWins };
}

/**
 * Write the server's value for the (key, lang) tuples in `serverOnly`
 * back to the local files, leaving everything else intact.
 *
 * We mutate the in-memory `localWordings` then ask the parser to write
 * only the (namespace, lang) files that actually changed. The parser's
 * write semantics overwrite each (lang, namespace).json file in full
 * with the keys present in `localWordings` for that namespace — but
 * since `localWordings` already represents what was on disk plus our
 * server overlay, the result preserves user-only keys and unchanged
 * langs.
 */
function applyServerOnlyToLocalFiles(
  serverOnly: ServerOnlyChange[],
  localWordings: Wording[],
  localesDir: string,
  parser: ReturnType<typeof getParser>,
): void {
  if (serverOnly.length === 0) return;

  // Index local for O(1) mutation
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
      // Server has a key we don't have locally — add it to the local
      // set so it gets written.
      w = {
        namespace: change.namespace,
        key: change.key,
        value_json: {},
      };
      localByNsKey.set(k, w);
      localWordings.push(w);
    }
    w.value_json[change.lang] = change.value;
  }

  // Write only the (namespace, lang) tuples we actually touched.
  const wordingsForWrite = localWordings.filter((w) =>
    affectedNs.has(w.namespace),
  );
  const languagesForWrite = Array.from(affectedLangs).map((code) => ({
    code,
    name: code,
  }));

  parser.write(localesDir, wordingsForWrite, languagesForWrite);
}

/**
 * Polls translation progress until done. Updates spinner message with % and ETA.
 * Returns true if completed, false if timed out.
 */
async function waitForTranslation(
  projectId: string,
  apiKey: string,
  spinner: ReturnType<typeof p.spinner>,
): Promise<boolean> {
  const startTime = Date.now();
  let lastMessage = "";
  let pollInterval = 500;
  let lastCompleted = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      return false;
    }

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    let progress: TranslationProgressResponse;
    try {
      progress = await callCliSync(
        "translation-progress",
        { project_id: projectId },
        apiKey,
      );
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors++;
      pollInterval = Math.min(pollInterval * 1.5, 8000);
      continue;
    }

    if (progress.status === "done") {
      return true;
    }

    const { total, completed, remaining } = progress;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const madeProgress = completed > lastCompleted;
    lastCompleted = completed;

    if (madeProgress) {
      pollInterval = Math.max(1000, Math.min(2000, remaining * 50));
    } else if (completed > 0) {
      pollInterval = Math.min(3000, pollInterval * 1.2);
    } else {
      pollInterval = Math.min(pollInterval * 1.3, 4000);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    let etaText = "calculating...";
    if (elapsed > 5 && completed > 0) {
      const rate = completed / elapsed;
      const remainingSeconds = Math.ceil(remaining / rate);
      etaText =
        remainingSeconds > 60
          ? `~${Math.ceil(remainingSeconds / 60)} min`
          : `~${remainingSeconds} sec`;
    }

    const msg = `Translating... ${percentage}% (${completed}/${total}) • ETA: ${etaText}`;
    if (msg !== lastMessage) {
      spinner.message(msg);
      lastMessage = msg;
    }
  }
}

export const pushCommand = new Command("push")
  .description("Push local translations to i1n")
  .option("--translate [langs]", "Trigger smart translate after push")
  .option(
    "--strategy <mode>",
    "Conflict resolution: interactive | ours | theirs | abort",
  )
  .option(
    "--force",
    "Overwrite server with local for any conflict (shorthand for --strategy ours)",
  )
  .action(async (opts) => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    const localesPath = path.resolve(config.localesDir);
    if (!fs.existsSync(localesPath)) {
      p.log.error(`Directory not found: ${config.localesDir}`);
      p.log.info(
        "Update localesDir in i1n.config.json or run `i1n init` again.",
      );
      process.exit(1);
    }

    p.intro("i1n push");

    const spinner = p.spinner();
    spinner.start("Reading local files...");

    const parser = getParser(config.format);
    const { wordings, warnings } = parser.read(
      config.localesDir,
      config.sourceLocale,
    );

    if (warnings.length > 0) {
      spinner.stop("Issues found while reading files");
      for (const w of warnings) {
        p.log.warn(`${path.relative(process.cwd(), w.file)}: ${w.message}`);
      }
    }

    if (wordings.length === 0) {
      spinner.stop("No translation keys found.");
      p.log.warn(`Directory exists but no ${config.format} files matched.`);
      p.log.info(`Looked in: ${localesPath}`);
      p.outro("Check your format setting in i1n.config.json.");
      return;
    }

    const namespaces = new Set(wordings.map((w) => w.namespace));
    spinner.stop(
      `${wordings.length} keys across ${namespaces.size} namespace(s)`,
    );

    // Fetch project limits for validation
    const limitsSpinner = p.spinner();
    limitsSpinner.start("Checking project limits...");

    let limits: ProjectLimitsResponse;
    try {
      limits = await callCliSync(
        "project-limits",
        { project_id: config.projectId },
        config.apiKey,
      );
    } catch (err) {
      limitsSpinner.stop("Could not check limits.");
      p.log.warn(err instanceof Error ? err.message : "Unknown error");
      p.outro("Push aborted.");
      return;
    }

    if (limits.is_locked) {
      limitsSpinner.stop("Project is locked (Read-Only).");
      p.log.error(
        "This project is locked due to plan limits. Please upgrade to enable pushing translations.",
      );
      p.outro("Push aborted.");
      return;
    }

    limitsSpinner.stop("Limits checked");

    // Normalize language codes and validate
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

    // Show normalization info
    for (const [from, to] of allMappings) {
      p.log.info(`Normalized "${from}" → "${to}"`);
    }
    for (const code of allUnsupported) {
      p.log.warn(`Unknown language code "${code}". Skipping.`);
    }

    // Check language slots: detect new languages that would exceed the limit
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
      // Only allow up to remaining_slots new languages
      const allowed = new Set(
        newLangs.slice(0, limits.languages.remaining_slots),
      );
      for (const lang of newLangs) {
        if (!allowed.has(lang)) exceededLangs.add(lang);
      }

      // Strip exceeded languages from wordings
      for (const wording of wordings) {
        for (const lang of exceededLangs) {
          delete wording.value_json[lang];
        }
      }

      p.log.warn(
        `Language limit reached (${limits.languages.used.length}/${limits.languages.limit}). ` +
          `Skipping: ${[...exceededLangs].join(", ")}. Upgrade your plan to add more languages.`,
      );
    }

    // Check wording limit: cap at remaining capacity
    const wordingCapacity = limits.wordings.limit - limits.wordings.used;
    if (wordings.length > wordingCapacity && wordingCapacity >= 0) {
      const excess = wordings.length - wordingCapacity;
      wordings.splice(wordingCapacity);
      p.log.warn(
        `Wording limit reached (${limits.wordings.used}/${limits.wordings.limit}). ` +
          `Pushing ${wordingCapacity} keys, skipping ${excess}. Upgrade your plan to increase the limit.`,
      );
    }

    if (wordings.length === 0) {
      p.outro("No keys to push after validation.");
      return;
    }

    // ────────────────────────────────────────────────────────────────
    // Three-way diff: Local (L) vs Server (S) vs Push-state baseline (P)
    // ────────────────────────────────────────────────────────────────
    const state = readPushState(config.localesDir);
    const stateEmpty = Object.keys(state.wordings).length === 0;

    // Step 1: cheap drift check. If state is empty we must fetch full S.
    // Otherwise, ask the server for just (namespace, key, updated_at) per
    // wording and compare against the timestamps we recorded last sync.
    let serverWordings: Wording[] = [];
    let needFullPull = stateEmpty;

    if (!stateEmpty) {
      const driftSpinner = p.spinner();
      driftSpinner.start("Checking for server-side changes...");
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
        // Drift if: any new server key, any deleted server key, or any
        // updated_at mismatch on a known key.
        if (serverKeyMap.size !== stateKeys.length) {
          needFullPull = true;
        } else {
          for (const sk of stateKeys) {
            const stateUpdatedAt = state.wordings[sk].updated_at;
            const serverUpdatedAt = serverKeyMap.get(sk);
            if (stateUpdatedAt !== serverUpdatedAt) {
              needFullPull = true;
              break;
            }
          }
        }
        driftSpinner.stop(
          needFullPull
            ? "Server has changes since last sync"
            : "Server in sync with baseline",
        );
      } catch {
        // pull-revisions failed (e.g. running against an old server that
        // doesn't expose this endpoint). Fall back to full pull so we
        // never silently push stale data.
        driftSpinner.stop("Revision check unavailable, doing full pull");
        needFullPull = true;
      }
    }

    if (needFullPull) {
      const pullSpinner = p.spinner();
      pullSpinner.start("Fetching current server state...");
      try {
        const pullResult: PullResponse = await callCliSync(
          "pull",
          { project_id: config.projectId },
          config.apiKey,
        );
        serverWordings = pullResult.wordings;
        pullSpinner.stop(
          `Fetched ${serverWordings.length} keys from server`,
        );
      } catch (err) {
        pullSpinner.stop("Could not fetch server state.");
        p.log.error(err instanceof Error ? err.message : "Unknown error");
        p.outro("Push aborted.");
        return;
      }
    } else {
      // No drift: synthesize server snapshot from state baseline. This is
      // safe because state == server when there's no drift.
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

    // Filter local-deletion warnings to those NOT explained by plan-trim.
    const realLocalDeletions = diff.localDeletions.filter(
      (d) => !exceededLangs.has(d.lang),
    );

    p.log.info(
      `${diff.toPush.length} local edits · ${diff.serverOnly.length} server-only · ${diff.conflicts.length} conflicts · ${diff.unchanged} unchanged`,
    );

    if (realLocalDeletions.length > 0) {
      const sample = realLocalDeletions.slice(0, 3)
        .map((d) => `${d.namespace}.${d.key} [${d.lang}]`)
        .join(", ");
      const more = realLocalDeletions.length > 3
        ? ` (+${realLocalDeletions.length - 3} more)`
        : "";
      p.log.warn(
        `${realLocalDeletions.length} lang value(s) exist on server but are missing locally${more}: ${sample}. The CLI does not propagate deletes — use the dashboard to remove them, or re-pull to bring them back.`,
      );
    }

    // ────────────────────────────────────────────────────────────────
    // Conflict resolution
    // ────────────────────────────────────────────────────────────────
    const resolvedToPush: typeof diff.toPush = [...diff.toPush];
    const resolvedServerOnly: typeof diff.serverOnly = [...diff.serverOnly];

    if (diff.conflicts.length > 0) {
      const strategy: string = opts.force
        ? "ours"
        : (opts.strategy ?? "interactive");

      if (strategy === "ours") {
        for (const c of diff.conflicts) {
          resolvedToPush.push({
            namespace: c.namespace, key: c.key, lang: c.lang, value: c.local,
          });
        }
        p.log.warn(
          `--force / --strategy ours: ${diff.conflicts.length} conflicts resolved by overwriting server with local.`,
        );
      } else if (strategy === "theirs") {
        for (const c of diff.conflicts) {
          resolvedServerOnly.push({
            namespace: c.namespace, key: c.key, lang: c.lang,
            value: c.server, previous: c.base,
          });
        }
        p.log.info(
          `--strategy theirs: ${diff.conflicts.length} conflicts resolved by accepting server values.`,
        );
      } else if (strategy === "abort") {
        p.log.error(
          `${diff.conflicts.length} conflicts detected. --strategy abort requested; no changes pushed.`,
        );
        renderConflicts(diff.conflicts);
        p.outro("Push aborted.");
        return;
      } else if (strategy === "interactive" && process.stdout.isTTY) {
        const resolution = await resolveConflictsInteractive(diff.conflicts);
        if (resolution === "abort") {
          p.outro("Push aborted.");
          return;
        }
        for (const c of resolution.localWins) {
          resolvedToPush.push({
            namespace: c.namespace, key: c.key, lang: c.lang, value: c.local,
          });
        }
        for (const c of resolution.serverWins) {
          resolvedServerOnly.push({
            namespace: c.namespace, key: c.key, lang: c.lang,
            value: c.server, previous: c.base,
          });
        }
      } else {
        // Non-TTY with no explicit strategy — refuse silently.
        p.log.error(
          `${diff.conflicts.length} conflict(s) require resolution. In non-interactive contexts, pass --strategy ours|theirs|abort.`,
        );
        renderConflicts(diff.conflicts);
        p.outro("Push aborted.");
        return;
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Auto-pull server-only changes to local files
    // ────────────────────────────────────────────────────────────────
    if (resolvedServerOnly.length > 0) {
      const soSpinner = p.spinner();
      soSpinner.start(
        `Auto-pulling ${resolvedServerOnly.length} server-only change(s) to local files...`,
      );
      try {
        applyServerOnlyToLocalFiles(
          resolvedServerOnly,
          wordings,
          config.localesDir,
          parser,
        );
        soSpinner.stop(
          `Wrote ${resolvedServerOnly.length} update(s) to locale files`,
        );
      } catch (err) {
        soSpinner.stop("Auto-pull failed.");
        p.log.warn(
          `Could not write server-only updates to disk: ${err instanceof Error ? err.message : String(err)}`,
        );
        p.log.info("Run `i1n pull` manually to bring them in.");
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Build the push payload and execute
    // ────────────────────────────────────────────────────────────────
    if (resolvedToPush.length === 0) {
      // Nothing to push, but state should advance so next push is fast.
      const nextState = buildNextState(serverWordings, {});
      writePushState(nextState, config.localesDir);

      if (diff.serverOnly.length === 0 && diff.conflicts.length === 0) {
        p.log.info("No changes to push.");
      } else {
        p.log.info("Local synced with server. Nothing to push.");
      }
    } else {
      // Group toPush by (ns, key); each wording carries only the langs
      // that actually changed. expected_updated_at comes from state P
      // for optimistic-concurrency on the server.
      const payloadByKey = new Map<string, Wording & { expected_updated_at?: string }>();
      for (const item of resolvedToPush) {
        const k = `${item.namespace}:${item.key}`;
        let w = payloadByKey.get(k);
        if (!w) {
          const stateEntry: PushStateEntry | undefined = state.wordings[k];
          w = {
            namespace: item.namespace,
            key: item.key,
            value_json: {},
            expected_updated_at: stateEntry?.updated_at,
          };
          payloadByKey.set(k, w);
        }
        w.value_json[item.lang] = item.value;
      }

      const payload = Array.from(payloadByKey.values());

      const pushSpinner = p.spinner();
      pushSpinner.start("Pushing to i1n...");

      const BATCH_SIZE = 500;
      let totalCreated = 0;
      let totalUpdated = 0;
      const serverSideConflicts: PushConflict[] = [];
      const pushedPerKeyLang: Record<string, Record<string, string>> = {};

      // Track per-batch what was sent so we can update state incrementally
      // even on a partial batch failure.
      const batchProgress: Wording[][] = [];
      for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        batchProgress.push(payload.slice(i, i + BATCH_SIZE));
      }

      for (let bi = 0; bi < batchProgress.length; bi++) {
        const batch = batchProgress[bi];
        try {
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
            pushSpinner.stop("Push completed with warnings.");
            p.log.warn(result.warning);
            pushSpinner.start("Continuing push...");
          }
          // Record what landed in this batch for the state file.
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
          // Atomic state write per successful batch — protects against
          // mid-loop crashes leaving the next push to re-send everything.
          const partialState = buildNextState(serverWordings, pushedPerKeyLang);
          writePushState(partialState, config.localesDir);
        } catch (err) {
          pushSpinner.stop("Push failed.");
          p.log.error(err instanceof Error ? err.message : "Unknown error");
          // State was updated for any prior successful batches.
          process.exit(1);
        }
      }

      pushSpinner.stop(
        `${totalCreated} created, ${totalUpdated} updated`,
      );

      if (serverSideConflicts.length > 0) {
        p.log.warn(
          `Server reported ${serverSideConflicts.length} stale item(s) (changed by another writer during this push). They were NOT updated. Re-run \`i1n push\` to resolve.`,
        );
        for (const c of serverSideConflicts.slice(0, 5)) {
          p.log.info(`  ${c.namespace}.${c.key}`);
        }
      }

      // Final state write — captures the full post-push baseline.
      const nextState = buildNextState(serverWordings, pushedPerKeyLang);
      writePushState(nextState, config.localesDir);
    }

    // Parse --translate flag for target languages
    let targetLangs: string[] | undefined;
    if (typeof opts.translate === "string") {
      targetLangs = opts.translate.split(",").map((l: string) => l.trim());
    }

    // Estimate translation cost
    const estimateSpinner = p.spinner();
    estimateSpinner.start("Checking translations...");

    let estimate: EstimateTranslateResponse;
    try {
      estimate = await callCliSync(
        "estimate-translate",
        {
          project_id: config.projectId,
          ...(targetLangs && { target_languages: targetLangs }),
        },
        config.apiKey,
      );
    } catch (err) {
      estimateSpinner.stop("Could not estimate translations.");
      p.log.warn(err instanceof Error ? err.message : "Unknown error");
      p.outro("Done! (push completed, translation check skipped)");
      return;
    }

    // Nothing to translate
    if (estimate.estimated_cost === 0) {
      estimateSpinner.stop("All translations up to date");
      p.outro("Done!");
      return;
    }

    // Show estimate breakdown
    estimateSpinner.stop("Missing translations found");

    p.log.info(
      `Available credits: ${estimate.available_credits} / ${estimate.credits_limit} WU`,
    );
    p.log.info(`Estimated cost: ${estimate.estimated_cost} WU`);
    if (estimate.cache_count > 0) {
      const cacheCost = estimate.cache_count * estimate.cache_cost_per_item;
      p.log.info(
        `  ${estimate.cache_count} from cache @ ${estimate.cache_cost_per_item} WU = ${cacheCost} WU`,
      );
    }
    if (estimate.ai_count > 0) {
      const aiCost = estimate.ai_count * estimate.ai_cost_per_item;
      p.log.info(
        `  ${estimate.ai_count} via AI @ ${estimate.ai_cost_per_item} WU = ${aiCost} WU`,
      );
    }

    if (estimate.estimated_cost > estimate.available_credits) {
      p.log.warn(
        "Insufficient credits for full translation. Upgrade your plan to get more WU.",
      );
    }

    // Ask to translate (skip prompt if --translate flag was passed)
    let shouldTranslate = opts.translate !== undefined;

    if (!shouldTranslate) {
      const confirm = await p.confirm({
        message: "Translate now?",
      });
      if (p.isCancel(confirm)) {
        p.outro("Done! (push completed)");
        return;
      }
      shouldTranslate = confirm;
    }

    if (!shouldTranslate) {
      p.log.info("Run `i1n push --translate` anytime to translate.");
      p.outro("Done!");
      return;
    }

    // Execute translation
    const translateSpinner = p.spinner();
    translateSpinner.start("Translating...");

    try {
      const result = await callCliSync(
        "translate",
        {
          project_id: config.projectId,
          ...(targetLangs && { target_languages: targetLangs }),
        },
        config.apiKey,
      );

      const cachedCount = Object.keys(result.cached).length;

      // Always stop the initial spinner first
      translateSpinner.stop(
        cachedCount > 0 && result.queued === 0
          ? "Smart Translate complete"
          : "Translate request sent",
      );

      if (cachedCount > 0) {
        p.log.success(`${cachedCount} translations resolved from cache`);
      }

      if (result.queued > 0) {
        // Wait for AI translations with progress bar
        const aiSpinner = p.spinner();
        aiSpinner.start(`Translating ${result.queued} items with AI...`);

        const completed = await waitForTranslation(config.projectId, config.apiKey, aiSpinner);

        if (completed) {
          aiSpinner.stop(`Translation complete (${result.queued} items)`);
        } else {
          aiSpinner.stop("Translation still processing in the background.");
          p.log.info("Run `i1n pull` in a few minutes to fetch completed translations.");
        }
      }

      if (result.credits_used > 0) {
        p.log.info(`Credits used: ${result.credits_used} WU`);
      }
    } catch (err) {
      translateSpinner.stop("Translation failed.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      p.outro("Done! (push completed, translation failed)");
      return;
    }

    // Auto-pull to get updated translations
    const pullSpinner = p.spinner();
    pullSpinner.start("Pulling updated translations...");

    try {
      const pullResult = await executePull(config);
      pullSpinner.stop(
        `${pullResult.wordings} keys, ${pullResult.languages} languages written`,
      );
      p.log.success(
        "Translations synced. Verify in your code or the i1n dashboard.",
      );
    } catch (err) {
      pullSpinner.stop("Pull failed.");
      p.log.warn(
        err instanceof Error ? err.message : "Could not pull translations.",
      );
      p.log.info("Run `i1n pull` manually to get updated translations.");
    }

    p.outro("Done!");
  });
