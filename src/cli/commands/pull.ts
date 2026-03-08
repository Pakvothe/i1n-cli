import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import { generateTypeDefinitions } from "../../shared/codegen.js";
import { writePushState } from "../../shared/push-state.js";
import type { I1nProjectConfig } from "../../shared/types.js";

/**
 * Core pull logic: fetch translations, write files, generate types, update push state.
 * Reused by both `i1n pull` command and auto-pull after translation in `i1n push`.
 */
export async function executePull(
  config: I1nProjectConfig,
): Promise<{ wordings: number; languages: number }> {
  const result = await callCliSync(
    "pull",
    { project_id: config.projectId },
    config.apiKey,
  );

  const { wordings, languages } = result;

  if (wordings.length === 0) {
    return { wordings: 0, languages: 0 };
  }

  // Write locale files
  const parser = getParser(config.format);
  const langObjects = languages.map((code: string) => ({ code, name: code }));
  parser.write(config.localesDir, wordings, langObjects);

  // Generate type definitions
  const typeDefs = generateTypeDefinitions(wordings, config.sourceLocale);
  const typesPath = path.join(config.localesDir, "i1n.d.ts");
  fs.mkdirSync(path.dirname(typesPath), { recursive: true });
  fs.writeFileSync(typesPath, typeDefs, "utf-8");

  // Update push state so next push only sends actual changes
  writePushState(wordings, config.localesDir);

  return { wordings: wordings.length, languages: languages.length };
}

export const pullCommand = new Command("pull")
  .description("Pull translations from i1n")
  .action(async () => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    p.intro("i1n pull");

    const spinner = p.spinner();
    spinner.start("Fetching translations...");

    let result;
    try {
      result = await executePull(config);
    } catch (err) {
      spinner.stop("Pull failed.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      process.exit(1);
    }

    if (result.wordings === 0) {
      spinner.stop("No translations found in this project.");
      p.outro("Add translations in the dashboard first, then pull again.");
      return;
    }

    spinner.stop(
      `${result.wordings} keys across ${result.languages} languages written`,
    );

    p.outro("Done!");
  });
