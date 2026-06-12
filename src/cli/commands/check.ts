import { Command } from "commander";
import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";

import { readProjectConfig } from "../../shared/config.js";
import { getParser } from "../../parsers/index.js";
import { runCheck } from "../../shared/check.js";
import type { CheckIssue, CheckReport } from "../../shared/check.js";

const ISSUE_LABELS: Record<CheckIssue["type"], string> = {
  parse_warning: "File problems",
  placeholder_mismatch: "Placeholder mismatches",
  missing_key: "Missing translations",
  empty_value: "Empty values",
};

// Locale file contents are untrusted: strip control chars (ANSI/OSC escapes)
// so a malicious key or value can't spoof or overwrite terminal output.
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

function formatIssue(issue: CheckIssue): string {
  const where = issue.namespace ? `${issue.namespace}.${issue.key}` : issue.key;
  const lang = issue.lang ? ` [${issue.lang}]` : "";
  return sanitize(`${where}${lang} — ${issue.detail}`);
}

function printReport(report: CheckReport): void {
  const grouped = new Map<CheckIssue["type"], CheckIssue[]>();
  for (const issue of report.issues) {
    const list = grouped.get(issue.type) ?? [];
    list.push(issue);
    grouped.set(issue.type, list);
  }

  for (const [type, label] of Object.entries(ISSUE_LABELS) as [CheckIssue["type"], string][]) {
    const list = grouped.get(type);
    if (!list || list.length === 0) continue;
    const log = list[0].severity === "error" ? p.log.error : p.log.warn;
    log(`${label} (${list.length})`);
    const limit = 20;
    for (const issue of list.slice(0, limit)) {
      p.log.info(`  ${formatIssue(issue)}`);
    }
    if (list.length > limit) {
      p.log.info(`  ...and ${list.length - limit} more`);
    }
  }

  const langs = Object.entries(report.coverage.byLanguage).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (langs.length > 0) {
    p.log.info("Coverage by language:");
    for (const [lang, pct] of langs) {
      p.log.info(`  ${lang.padEnd(8)} ${pct.toFixed(1)}%`);
    }
  }
}

export const checkCommand = new Command("check")
  .description(
    "Validate local translation files: missing keys, broken placeholders, coverage. Offline — safe for CI.",
  )
  .option(
    "--min-coverage <percent>",
    "Fail when overall translation coverage is below this percentage",
    parseFloat,
  )
  .option("--json", "Output the full report as JSON (for CI tooling)")
  .action(async (options: { minCoverage?: number; json?: boolean }) => {
    const config = readProjectConfig();
    if (!config) {
      console.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(2);
    }

    if (
      options.minCoverage !== undefined &&
      (Number.isNaN(options.minCoverage) ||
        options.minCoverage < 0 ||
        options.minCoverage > 100)
    ) {
      console.error("--min-coverage must be a number between 0 and 100.");
      process.exit(2);
    }

    const localesPath = path.resolve(process.cwd(), config.localesDir);
    if (!fs.existsSync(localesPath)) {
      console.error(`Directory not found: ${config.localesDir}`);
      process.exit(2);
    }

    const parser = getParser(config.format);
    const { wordings, warnings } = parser.read(config.localesDir, config.sourceLocale);

    // Zero keys means the parser found nothing — almost always a format/dir
    // mismatch in config. A green "0 keys" exit would be a false pass in CI.
    if (wordings.length === 0) {
      console.error(
        `No translation keys found in ${config.localesDir} with format "${config.format}". Check the format and localesDir settings in i1n.config.json.`,
      );
      process.exit(2);
    }
    const report = runCheck(config, wordings, warnings, {
      minCoverage: options.minCoverage,
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.counts.errors > 0 ? 1 : 0);
    }

    p.intro("i1n check");

    p.log.info(
      `${report.counts.keys} keys · ${report.languages.length} language(s) · ${report.coverage.overall.toFixed(1)}% translated`,
    );

    printReport(report);

    if (report.counts.errors > 0) {
      p.outro(
        `${report.counts.errors} error(s), ${report.counts.warnings} warning(s). Fix errors before shipping.`,
      );
      process.exit(1);
    }

    if (report.counts.warnings > 0) {
      p.outro(
        `No errors. ${report.counts.warnings} warning(s) — run \`i1n push --translate\` to fill gaps.`,
      );
      process.exit(0);
    }

    p.outro("All translations are consistent. Ship it.");
    process.exit(0);
  });
