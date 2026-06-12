import fs from "node:fs";
import path from "node:path";

import { readProjectConfig } from "../../shared/config.js";
import { getParser } from "../../parsers/index.js";
import { runCheck } from "../../shared/check.js";
import { text, error } from "./helpers.js";

export async function handleCheck(args: { minCoverage?: number }) {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  const localesPath = path.resolve(process.cwd(), config.localesDir);
  if (!fs.existsSync(localesPath)) {
    return error(`Directory not found: ${config.localesDir}`);
  }

  try {
    const parser = getParser(config.format);
    const { wordings, warnings } = parser.read(config.localesDir, config.sourceLocale);
    if (wordings.length === 0) {
      return error(
        `No translation keys found in ${config.localesDir} with format "${config.format}". Check the format and localesDir settings in i1n.config.json.`,
      );
    }
    const report = runCheck(config, wordings, warnings, {
      minCoverage: args.minCoverage,
    });
    return text(JSON.stringify(report, null, 2));
  } catch (err) {
    return error(err instanceof Error ? err.message : "Check failed");
  }
}
