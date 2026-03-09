import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { executePull } from "./pull.js";
import type { ProjectLimitsResponse } from "../../shared/types.js";

export const addLanguageCommand = new Command("add-language")
  .description("Add a new language to your project")
  .action(async () => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    p.intro("i1n add-language");

    // Fetch project limits and current languages
    const spinner = p.spinner();
    spinner.start("Loading project info...");

    let limits: ProjectLimitsResponse;
    try {
      limits = await callCliSync(
        "project-limits",
        { project_id: config.projectId },
        config.apiKey,
      );
    } catch (err) {
      spinner.stop("Failed to load project info.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      process.exit(1);
    }

    if (limits.is_locked) {
      spinner.stop("Project is locked (Read-Only).");
      p.log.error(
        "This project is locked due to plan limits. Please upgrade to enable adding languages.",
      );
      p.outro("Aborted.");
      return;
    }

    const { active, used, limit, remaining_slots } = limits.languages;

    spinner.stop(
      `${active.length} active language(s), ${remaining_slots} slot(s) available`,
    );

    // Show current active languages
    if (active.length > 0) {
      p.log.info(`Active: ${active.join(", ")}`);
    }

    if (remaining_slots === 0) {
      p.log.error(
        `Language limit reached (${used.length}/${limit}). Upgrade your plan to add more languages.`,
      );
      p.outro("Done.");
      return;
    }

    // Build options from available_languages (already sorted alphabetically, filtered by plan)
    const activeSet = new Set(active);
    const available = limits.available_languages.filter(
      (l) => !activeSet.has(l.code),
    );

    if (available.length === 0) {
      p.log.info("All available languages are already active.");
      p.outro("Done.");
      return;
    }

    // Group by base language (e.g. "English", "Español")
    const groups = new Map<string, typeof available>();
    for (const lang of available) {
      const group = groups.get(lang.language) ?? [];
      group.push(lang);
      groups.set(lang.language, group);
    }

    // Step 1: Pick base language(s)
    const languageOptions = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([language, variants]) => ({
        value: language,
        label:
          variants.length > 1
            ? `${language} (${variants.length} variants)`
            : `${variants[0].flag}  ${language} — ${variants[0].name} (${variants[0].code})`,
      }));

    const selectedLanguages = await p.multiselect({
      message: `Select language(s) to add (${remaining_slots} slot(s) available, press space to select)`,
      options: languageOptions,
      required: true,
    });

    if (p.isCancel(selectedLanguages)) {
      p.cancel("Cancelled.");
      return;
    }

    // Step 2: For languages with multiple variants, pick specific variant(s)
    const selectedCodes: string[] = [];

    for (const language of selectedLanguages as string[]) {
      const variants = groups.get(language)!;

      if (variants.length === 1) {
        // Single variant — auto-select
        selectedCodes.push(variants[0].code);
        continue;
      }

      const variantOptions = variants.map((v) => ({
        value: v.code,
        label: `${v.flag}  ${v.name} (${v.code})`,
      }));

      const selectedVariants = await p.multiselect({
        message: `Select ${language} variant(s) (press space to select)`,
        options: variantOptions,
        required: true,
      });

      if (p.isCancel(selectedVariants)) {
        p.cancel("Cancelled.");
        return;
      }

      selectedCodes.push(...(selectedVariants as string[]));
    }

    // Check if selection exceeds remaining slots
    // Reactivations (in used but not active) don't consume slots
    const freshNew = selectedCodes.filter((c) => !used.includes(c));
    if (freshNew.length > remaining_slots) {
      p.log.error(
        `Selected ${freshNew.length} new language(s) but only ${remaining_slots} slot(s) available. ` +
          `Upgrade your plan to add more languages.`,
      );
      p.outro("Done.");
      return;
    }

    // Add languages via backend
    const addSpinner = p.spinner();
    addSpinner.start("Adding languages...");

    try {
      const result = await callCliSync(
        "add-language",
        { project_id: config.projectId, languages: selectedCodes },
        config.apiKey,
      );

      if (result.added.length > 0) {
        addSpinner.stop(`Added: ${result.added.join(", ")}`);
      } else {
        addSpinner.stop("Languages already active");
      }
    } catch (err) {
      addSpinner.stop("Failed to add languages.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      process.exit(1);
    }

    // Offer to translate existing keys to new languages
    const doTranslate = await p.confirm({
      message: "Translate existing keys to the new language(s)?",
    });

    if (p.isCancel(doTranslate) || !doTranslate) {
      p.log.info("Run `i1n push --translate` anytime to translate.");
      p.outro("Done!");
      return;
    }

    // Estimate translation cost
    const estimateSpinner = p.spinner();
    estimateSpinner.start("Estimating translation cost...");

    try {
      const estimate = await callCliSync(
        "estimate-translate",
        {
          project_id: config.projectId,
          target_languages: selectedCodes,
        },
        config.apiKey,
      );

      if (estimate.estimated_cost === 0) {
        estimateSpinner.stop("No translations needed");
        p.outro("Done!");
        return;
      }

      estimateSpinner.stop("Estimate ready");

      p.log.info(
        `Available credits: ${estimate.available_credits} / ${estimate.credits_limit} WU`,
      );
      p.log.info(`Estimated cost: ${estimate.estimated_cost} WU`);

      if (estimate.estimated_cost > estimate.available_credits) {
        p.log.warn(
          "Insufficient credits for full translation. Upgrade your plan to get more WU.",
        );
        p.outro("Done! (languages added, translation skipped)");
        return;
      }

      const confirmTranslate = await p.confirm({
        message: `Translate now? (${estimate.estimated_cost} WU)`,
      });

      if (p.isCancel(confirmTranslate) || !confirmTranslate) {
        p.log.info("Run `i1n push --translate` anytime to translate.");
        p.outro("Done!");
        return;
      }

      // Execute translation
      const translateSpinner = p.spinner();
      translateSpinner.start("Translating...");

      const result = await callCliSync(
        "translate",
        {
          project_id: config.projectId,
          target_languages: selectedCodes,
        },
        config.apiKey,
      );

      const cachedCount = Object.keys(result.cached).length;

      translateSpinner.stop(
        cachedCount > 0 && result.queued === 0
          ? "Smart Translate complete"
          : "Translate request sent",
      );

      if (cachedCount > 0) {
        p.log.success(`${cachedCount} translations resolved from cache`);
      }

      if (result.queued > 0) {
        const aiSpinner = p.spinner();
        aiSpinner.start(`Translating ${result.queued} items with AI...`);

        // Poll for progress
        const startTime = Date.now();
        let lastMessage = "";

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const progress = await callCliSync(
              "translation-progress",
              { project_id: config.projectId },
              config.apiKey,
            );

            if (progress.status === "done") break;

            const { total, completed, remaining } = progress;
            const percentage =
              total > 0 ? Math.round((completed / total) * 100) : 0;

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
              aiSpinner.message(msg);
              lastMessage = msg;
            }
          } catch {
            continue;
          }
        }

        aiSpinner.stop(`Translation complete (${result.queued} items)`);
      }

      if (result.credits_used > 0) {
        p.log.info(`Credits used: ${result.credits_used} WU`);
      }

      // Auto-pull
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
      } catch {
        pullSpinner.stop("Pull failed.");
        p.log.info("Run `i1n pull` manually to get updated translations.");
      }
    } catch (err) {
      estimateSpinner.stop("Translation failed.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
    }

    p.outro("Done!");
  });
