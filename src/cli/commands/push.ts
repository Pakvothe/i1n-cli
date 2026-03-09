import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import { getChangedWordings, writePushState } from "../../shared/push-state.js";
import { normalizeWordingLanguages } from "../../shared/languages.js";
import { executePull } from "./pull.js";
import type { EstimateTranslateResponse, ProjectLimitsResponse, TranslationProgressResponse } from "../../shared/types.js";

/**
 * Polls translation progress until done. Updates spinner message with % and ETA.
 */
async function waitForTranslation(
  projectId: string,
  apiKey: string,
  spinner: ReturnType<typeof p.spinner>,
): Promise<void> {
  const startTime = Date.now();
  let lastMessage = "";

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    let progress: TranslationProgressResponse;
    try {
      progress = await callCliSync(
        "translation-progress",
        { project_id: projectId },
        apiKey,
      );
    } catch {
      continue;
    }

    if (progress.status === "done") {
      break;
    }

    const { total, completed, remaining } = progress;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    // ETA calculation (same formula as dashboard SmartProgressBar)
    const elapsed = (Date.now() - startTime) / 1000;
    let etaText = "calculating...";
    if (elapsed > 5 && completed > 0) {
      const rate = completed / elapsed;
      const remainingSeconds = Math.ceil(remaining / rate);
      etaText = remainingSeconds > 60
        ? `~${Math.ceil(remainingSeconds / 60)} min`
        : `~${remainingSeconds} sec`;
    }

    const msg = `Translating... ${percentage}% (${completed}/${total}) • ETA: ${etaText}`;
    // Only update spinner when message actually changed to avoid flicker
    if (msg !== lastMessage) {
      spinner.message(msg);
      lastMessage = msg;
    }
  }
}

export const pushCommand = new Command("push")
  .description("Push local translations to i1n")
  .option("--translate [langs]", "Trigger smart translate after push")
  .action(async (opts) => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    const localesPath = path.resolve(config.localesDir);
    if (!fs.existsSync(localesPath)) {
      p.log.error(`Directory not found: ${config.localesDir}`);
      p.log.info("Update localesDir in i1n.config.json or run `i1n init` again.");
      process.exit(1);
    }

    p.intro("i1n push");

    const spinner = p.spinner();
    spinner.start("Reading local files...");

    const parser = getParser(config.format);
    const { wordings, warnings } = parser.read(config.localesDir, config.sourceLocale);

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

    const newLangs = [...localLangs].filter((c) => !limits.languages.used.includes(c));
    const exceededLangs = new Set<string>();

    if (newLangs.length > limits.languages.remaining_slots) {
      // Only allow up to remaining_slots new languages
      const allowed = new Set(newLangs.slice(0, limits.languages.remaining_slots));
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

    // Diff against last push state
    const { changed, unchanged } = getChangedWordings(wordings, config.localesDir);

    if (changed.length === 0) {
      p.log.info(`No changes detected (${unchanged} keys unchanged)`);
    } else {
      if (unchanged > 0) {
        p.log.info(`${changed.length} changed, ${unchanged} unchanged (skipped)`);
      }

      // Push only changed wordings
      const pushSpinner = p.spinner();
      pushSpinner.start("Pushing to i1n...");

      const BATCH_SIZE = 50;
      let totalCreated = 0;
      let totalUpdated = 0;

      for (let i = 0; i < changed.length; i += BATCH_SIZE) {
        const batch = changed.slice(i, i + BATCH_SIZE);

        try {
          const result = await callCliSync(
            "push",
            { project_id: config.projectId, wordings: batch },
            config.apiKey,
          );
          totalCreated += result.created;
          totalUpdated += result.updated;
        } catch (err) {
          pushSpinner.stop("Push failed.");
          p.log.error(err instanceof Error ? err.message : "Unknown error");
          process.exit(1);
        }
      }

      pushSpinner.stop(
        `${changed.length} keys synced (${totalCreated} created, ${totalUpdated} updated)`,
      );

      // Save state after successful push
      writePushState(wordings, config.localesDir);
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

    p.log.info(`Available credits: ${estimate.available_credits} / ${estimate.credits_limit} WU`);
    p.log.info(`Estimated cost: ${estimate.estimated_cost} WU`);
    if (estimate.cache_count > 0) {
      const cacheCost = estimate.cache_count * estimate.cache_cost_per_item;
      p.log.info(`  ${estimate.cache_count} from cache @ ${estimate.cache_cost_per_item} WU = ${cacheCost} WU`);
    }
    if (estimate.ai_count > 0) {
      const aiCost = estimate.ai_count * estimate.ai_cost_per_item;
      p.log.info(`  ${estimate.ai_count} via AI @ ${estimate.ai_cost_per_item} WU = ${aiCost} WU`);
    }

    if (estimate.estimated_cost > estimate.available_credits) {
      p.log.warn("Insufficient credits for full translation. Upgrade your plan to get more WU.");
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

        await waitForTranslation(config.projectId, config.apiKey, aiSpinner);

        aiSpinner.stop(`Translation complete (${result.queued} items)`);
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
      p.log.success("Translations synced. Verify in your code or the i1n dashboard.");
    } catch (err) {
      pullSpinner.stop("Pull failed.");
      p.log.warn(err instanceof Error ? err.message : "Could not pull translations.");
      p.log.info("Run `i1n pull` manually to get updated translations.");
    }

    p.outro("Done!");
  });
