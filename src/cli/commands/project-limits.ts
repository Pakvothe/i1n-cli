import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";

export const projectLimitsCommand = new Command("limits")
  .description("Show project limits and usage")
  .action(async () => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    p.intro("i1n limits");

    const spinner = p.spinner();
    spinner.start("Loading project limits...");

    try {
      const limits = await callCliSync(
        "project-limits",
        { project_id: config.projectId },
        config.apiKey,
      );

      spinner.stop(`Plan: ${limits.plan_id}`);

      p.log.info(`Wording keys: ${limits.wordings.used} / ${limits.wordings.limit}`);
      p.log.info(`Credits (WU): ${limits.credits.used} / ${limits.credits.limit}`);
      p.log.info(`Languages: ${limits.languages.used.length} / ${limits.languages.limit} slots used`);

      if (limits.languages.active.length > 0) {
        p.log.info(`Active: ${limits.languages.active.join(", ")}`);
      }

      if (limits.languages.remaining_slots > 0) {
        p.log.info(`${limits.languages.remaining_slots} language slot(s) available`);
      }

      p.outro("Done!");
    } catch (err) {
      spinner.stop("Failed to load limits.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      process.exit(1);
    }
  });
