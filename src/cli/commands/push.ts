import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { readCredentials, readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";

export const pushCommand = new Command("push")
  .description("Push local translations to i1n")
  .option("--translate [langs]", "Trigger smart translate after push")
  .action(async (opts) => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    const creds = readCredentials();
    if (!creds) {
      p.log.error("Not authenticated. Run `i1n init` first.");
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

    const pushSpinner = p.spinner();
    pushSpinner.start("Pushing to i1n...");

    const BATCH_SIZE = 50;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (let i = 0; i < wordings.length; i += BATCH_SIZE) {
      const batch = wordings.slice(i, i + BATCH_SIZE);

      try {
        const result = await callCliSync(
          "push",
          { project_id: config.projectId, wordings: batch },
          creds.api_key,
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
      `${wordings.length} keys synced (${totalCreated} created, ${totalUpdated} updated)`,
    );

    if (opts.translate !== undefined) {
      await handleTranslate(creds.api_key, config.projectId, opts.translate);
    }

    p.outro("Done!");
  });

async function handleTranslate(
  apiKey: string,
  projectId: string,
  langsArg: string | true,
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Fetching project languages...");

  let targetLangs: string[] | undefined;

  if (typeof langsArg === "string") {
    targetLangs = langsArg.split(",").map((l) => l.trim());
  }

  try {
    const result = await callCliSync(
      "translate",
      {
        project_id: projectId,
        ...(targetLangs && { target_languages: targetLangs }),
      },
      apiKey,
    );

    const cachedCount = Object.keys(result.cached).length;
    spinner.stop("Smart Translate complete");

    if (cachedCount > 0) {
      p.log.success(`${cachedCount} translations resolved from cache`);
    }
    if (result.queued > 0) {
      p.log.info(
        `${result.queued} queued for AI translation (processing in background)`,
      );
    }
    if (result.credits_used > 0) {
      p.log.info(`Credits used: ${result.credits_used} WU`);
    }
  } catch (err) {
    spinner.stop("Translation failed.");
    p.log.error(err instanceof Error ? err.message : "Unknown error");
  }
}
