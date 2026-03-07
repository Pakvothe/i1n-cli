import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { detect } from "../../detector/index.js";
import { getParser } from "../../parsers/index.js";
import {
  readCredentials,
  writeCredentials,
  writeProjectConfig,
  projectConfigExists,
} from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import type { Format, Framework, I1nCredentials } from "../../shared/types.js";

const API_KEY_REGEX = /^i1n_[a-f0-9]{32}$/;

const FORMAT_LABELS: Record<Format, string> = {
  "nested-json": "Nested JSON — locales/{lang}/{ns}.json",
  "flat-json": "Flat JSON — locales/{lang}/{ns}.json (dot-notation keys)",
  arb: "ARB — lib/l10n/app_{lang}.arb (Flutter)",
  yaml: "YAML — config/locales/{lang}.yml (Rails)",
  "android-xml": "Android XML — res/values-{lang}/strings.xml",
  "apple-strings": "Apple Strings — {lang}.lproj/Localizable.strings",
  typescript: "TypeScript — locales/{lang}/{ns}.ts",
};

export const initCommand = new Command("init")
  .description("Set up i1n in your project")
  .action(async () => {
    p.intro("i1n — Localization as code");

    let creds = readCredentials();

    if (!creds) {
      creds = await authenticateFlow();
      if (!creds) return;
    } else {
      p.log.success(`Authenticated (project: ${creds.project_id.slice(0, 8)}...)`);
    }

    if (projectConfigExists()) {
      const overwrite = await p.confirm({
        message: "i1n.config.json already exists. Overwrite?",
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Cancelled.");
        return;
      }
    }

    const detection = detect(process.cwd());

    let framework: Framework;
    let format: Format;
    let localesDir: string;
    let sourceLocale: string;

    if (detection) {
      p.log.info(`Detected: ${detection.framework}`);
      p.log.info(`Locales: ${detection.localesDir}`);
      p.log.info(`Format: ${detection.format}`);
      p.log.info(`Source language: ${detection.sourceLocale}`);

      const parser = getParser(detection.format);
      const result = parser.read(detection.localesDir, detection.sourceLocale);

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          p.log.warn(`${path.relative(process.cwd(), w.file)}: ${w.message}`);
        }
      }

      if (result.wordings.length > 0) {
        const namespaces = new Set(result.wordings.map((w) => w.namespace));
        p.log.info(`Found ${result.wordings.length} keys across ${namespaces.size} namespace(s)`);
      }

      const confirm = await p.confirm({
        message: "Use detected settings?",
      });

      if (p.isCancel(confirm)) {
        p.cancel("Cancelled.");
        return;
      }

      if (confirm) {
        framework = detection.framework;
        format = detection.format;
        localesDir = detection.localesDir;
        sourceLocale = detection.sourceLocale;
      } else {
        const manual = await manualSetup(detection);
        if (!manual) return;
        ({ framework, format, localesDir, sourceLocale } = manual);
      }
    } else {
      p.log.warn("Could not auto-detect your i18n setup.");
      p.log.info("You can specify your locale directory and format manually.");
      const manual = await manualSetup(null);
      if (!manual) return;
      ({ framework, format, localesDir, sourceLocale } = manual);
    }

    if (!fs.existsSync(localesDir)) {
      const create = await p.confirm({
        message: `Directory "${localesDir}" doesn't exist. Create it?`,
      });
      if (p.isCancel(create)) {
        p.cancel("Cancelled.");
        return;
      }
      if (create) {
        fs.mkdirSync(localesDir, { recursive: true });
        p.log.success(`Created ${localesDir}/`);
      }
    }

    writeProjectConfig({
      projectId: creds.project_id,
      localesDir,
      sourceLocale,
      format,
      framework,
    });

    p.log.success("Config saved to i1n.config.json");
    p.outro("Run `i1n push` to sync your translations.");
  });

async function authenticateFlow(): Promise<I1nCredentials | null> {
  const apiKey = await p.text({
    message: "Paste your API key (from your i1n dashboard)",
    placeholder: "i1n_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    validate: (value) => {
      if (!API_KEY_REGEX.test(value)) {
        return "Invalid format. Expected: i1n_ followed by 32 hex characters.";
      }
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("Cancelled.");
    return null;
  }

  const spinner = p.spinner();
  spinner.start("Validating API key...");

  let result;
  try {
    result = await callCliSync("validate", {}, apiKey);
  } catch (err) {
    spinner.stop("Authentication failed.");
    p.log.error(err instanceof Error ? err.message : "Could not validate API key.");
    return null;
  }

  spinner.stop(`Connected to "${result.org_name}"`);

  let projectId: string;

  if (result.projects.length === 0) {
    p.log.error("No projects found in this organization.");
    return null;
  }

  if (result.projects.length === 1) {
    projectId = result.projects[0].id;
    p.log.info(`Project: ${result.projects[0].name}`);
  } else {
    const selected = await p.select({
      message: "Select a project",
      options: result.projects.map((proj) => ({
        value: proj.id,
        label: proj.name,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      return null;
    }

    projectId = selected;
  }

  const creds: I1nCredentials = {
    api_key: apiKey,
    project_id: projectId,
  };

  writeCredentials(creds);
  return creds;
}

interface ManualConfig {
  framework: Framework;
  format: Format;
  localesDir: string;
  sourceLocale: string;
}

async function manualSetup(
  defaults: { framework: Framework; format: Format; localesDir: string; sourceLocale: string } | null,
): Promise<ManualConfig | null> {
  const localesDir = await p.text({
    message: "Locales directory",
    initialValue: defaults?.localesDir ?? "locales",
  });
  if (p.isCancel(localesDir)) {
    p.cancel("Cancelled.");
    return null;
  }

  const sourceLocale = await p.text({
    message: "Source locale code (e.g. en, en_us, pt_br)",
    initialValue: defaults?.sourceLocale ?? "en",
    validate: (val) => {
      if (!/^[a-z]{2}([_-][a-zA-Z]{2,4})?$/.test(val)) {
        return "Invalid locale code. Examples: en, en_us, pt_br";
      }
    },
  });
  if (p.isCancel(sourceLocale)) {
    p.cancel("Cancelled.");
    return null;
  }

  const format = await p.select<Format>({
    message: "File format",
    options: (Object.entries(FORMAT_LABELS) as [Format, string][]).map(([value, label]) => ({
      value,
      label,
    })),
    initialValue: defaults?.format,
  });
  if (p.isCancel(format)) {
    p.cancel("Cancelled.");
    return null;
  }

  return {
    framework: defaults?.framework ?? "generic",
    format,
    localesDir,
    sourceLocale,
  };
}
