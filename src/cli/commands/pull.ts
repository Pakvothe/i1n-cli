import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import { generateTypeDefinitions } from "../../shared/codegen.js";
import { expandWordings } from "../../shared/constants.js";
import { buildNextState, writePushState } from "../../shared/push-state.js";
import { ensureConfigInclude } from "../../shared/tsconfig.js";
import type { I1nProjectConfig } from "../../shared/types.js";

/**
 * Core pull logic: fetch translations, write files, generate types, update push state.
 * Reused by both `i1n pull` command and auto-pull after translation in `i1n push`.
 */
export async function executePull(
  config: I1nProjectConfig,
): Promise<{ wordings: number; languages: number; missingConstants: string[] }> {
  // raw_constants: receive `{@NAME}` markers + the constants map and expand
  // here, so `push` can contract edited files back to markers. Servers that
  // predate constants ignore the flag and send plain values.
  const result = await callCliSync(
    "pull",
    { project_id: config.projectId, raw_constants: true },
    config.apiKey,
  );

  const { wordings, languages } = result;
  const constants = result.constants ?? null;
  const constantsHash = result.constants_hash;

  if (wordings.length === 0) {
    return { wordings: 0, languages: 0, missingConstants: [] };
  }

  // Write locale files with constants expanded. `wordings` (markers) stays
  // untouched: it is the server baseline for the push state and codegen.
  const parser = getParser(config.format);
  const langObjects = languages.map((l: any) =>
    typeof l === "string" ? { code: l, name: l } : l,
  );
  const expanded = expandWordings(wordings, constants);
  parser.write(config.localesDir, expanded.wordings, langObjects);

  // Generate type definitions
  const typeDefs = generateTypeDefinitions(wordings, config.sourceLocale);
  const typesPath = path.join(config.localesDir, "i1n.d.ts");
  fs.mkdirSync(path.dirname(typesPath), { recursive: true });
  fs.writeFileSync(typesPath, typeDefs, "utf-8");

  // Update push state so the next `i1n push` sees the freshly-pulled
  // server snapshot as its baseline. State v2 carries per-language
  // values + per-key updated_at, enabling the three-way diff and
  // optimistic-concurrency token forwarding.
  writePushState(
    buildNextState(wordings, {}, { constants, hash: constantsHash }),
    config.localesDir,
  );

  // Ensure IDE finds the types (DX automation)
  ensureConfigInclude(config.localesDir);

  return {
    wordings: wordings.length,
    languages: languages.length,
    missingConstants: expanded.missing,
  };
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

    if (result.missingConstants.length > 0) {
      p.log.warn(
        `Undefined constant(s) referenced by wordings: ${result.missingConstants.map((n) => `{@${n}}`).join(", ")}. ` +
          "They were written as literal markers. Define them in the dashboard (Settings → AI Context → Constants) and pull again.",
      );
    }

    p.outro("Done!");
  });
