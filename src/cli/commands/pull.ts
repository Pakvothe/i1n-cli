import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { readCredentials, readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import { generateTypeDefinitions } from "../../shared/codegen.js";

export const pullCommand = new Command("pull")
  .description("Pull translations from i1n")
  .action(async () => {
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

    p.intro("i1n pull");

    const spinner = p.spinner();
    spinner.start("Fetching translations...");

    let result;
    try {
      result = await callCliSync(
        "pull",
        { project_id: config.projectId },
        creds.api_key,
      );
    } catch (err) {
      spinner.stop("Pull failed.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
      process.exit(1);
    }

    const { wordings, languages, namespaces } = result;

    spinner.stop(
      `${wordings.length} keys, ${languages.length} languages, ${namespaces.length} namespace(s)`,
    );

    if (wordings.length === 0) {
      p.log.warn("No translations found in this project.");
      p.outro("Add translations in the dashboard first, then pull again.");
      return;
    }

    const writeSpinner = p.spinner();
    writeSpinner.start("Writing files...");

    try {
      const parser = getParser(config.format);
      parser.write(config.localesDir, wordings, languages);
      writeSpinner.stop("Files written");
    } catch (err) {
      writeSpinner.stop("Failed to write files.");
      p.log.error(err instanceof Error ? err.message : "Could not write to disk.");
      process.exit(1);
    }

    const typeSpinner = p.spinner();
    typeSpinner.start("Generating types...");

    try {
      const typeDefs = generateTypeDefinitions(wordings, config.sourceLocale);
      const typesPath = path.join(config.localesDir, "i1n.d.ts");
      fs.mkdirSync(path.dirname(typesPath), { recursive: true });
      fs.writeFileSync(typesPath, typeDefs, "utf-8");
      typeSpinner.stop(`Types generated at ${typesPath}`);
    } catch (err) {
      typeSpinner.stop("Failed to generate types.");
      p.log.error(err instanceof Error ? err.message : "Unknown error");
    }

    p.outro(
      `${wordings.length} keys across ${languages.length} languages`,
    );
  });
