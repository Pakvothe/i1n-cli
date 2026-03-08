import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import * as p from "@clack/prompts";
import { detect, detectFramework } from "../../detector/index.js";
import { getParser } from "../../parsers/index.js";
import {
  writeProjectConfig,
  projectConfigExists,
  ensureGitignore,
} from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { writeAIConfigs } from "../../shared/ai-config.js";
import { promptAITools } from "./setup-ai.js";
import type { Format, Framework } from "../../shared/types.js";

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

    if (projectConfigExists()) {
      const overwrite = await p.confirm({
        message: "i1n.config.json already exists. Overwrite?",
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Cancelled.");
        return;
      }
    }

    // 1. Ask for API key
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
      return;
    }

    // 2. Validate key and get org/projects
    const spinner = p.spinner();
    spinner.start("Validating API key...");

    let validateResult;
    try {
      validateResult = await callCliSync("validate", {}, apiKey);
    } catch (err) {
      spinner.stop("Authentication failed.");
      p.log.error(err instanceof Error ? err.message : "Could not validate API key.");
      return;
    }

    spinner.stop(`Connected to "${validateResult.org_name}"`);

    // 3. Select project
    const projects = validateResult.projects;

    if (projects.length === 0) {
      p.log.error("No projects found in this organization.");
      return;
    }

    let projectId: string;
    let projectLanguages: string[] = [];

    if (projects.length === 1) {
      projectId = projects[0].id;
      projectLanguages = projects[0].used_languages ?? [];
      p.log.info(`Project: ${projects[0].name}`);
    } else {
      const selected = await p.select({
        message: "Select a project",
        options: projects.map((proj) => ({
          value: proj.id,
          label: proj.name,
        })),
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        return;
      }

      projectId = selected;
      projectLanguages = projects.find((proj) => proj.id === selected)?.used_languages ?? [];
    }

    // 4. Detect or manually configure format/locales
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
        const manual = await manualSetup(detection, projectLanguages);
        if (!manual) return;
        ({ framework, format, localesDir, sourceLocale } = manual);
      }
    } else {
      p.log.warn("Could not auto-detect your i18n setup.");
      p.log.info("You can specify your locale directory and format manually.");
      const manual = await manualSetup(null, projectLanguages);
      if (!manual) return;
      ({ framework, format, localesDir, sourceLocale } = manual);
    }

    // 5. Create locales dir if needed
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

    // 6. Write config and ensure gitignore
    writeProjectConfig({
      apiKey,
      projectId,
      localesDir,
      sourceLocale,
      format,
      framework,
    });

    ensureGitignore();

    p.log.success("Config saved to i1n.config.json");
    p.log.info("Added i1n.config.json to .gitignore");

    // 7. AI assistant rules (optional)
    const setupAI = await p.confirm({
      message: "Set up AI assistant rules for i1n?",
    });

    if (!p.isCancel(setupAI) && setupAI) {
      const tools = await promptAITools();
      if (tools) {
        const written = writeAIConfigs(tools, {
          apiKey,
          projectId,
          localesDir,
          sourceLocale,
          format,
          framework,
        });
        for (const file of written) {
          p.log.success(`Created ${file}`);
        }
      }
    } else {
      p.log.info("Run `i1n setup-ai` anytime to configure AI rules.");
    }

    p.outro("Run `i1n push` to sync your translations.");
  });

interface ManualConfig {
  framework: Framework;
  format: Format;
  localesDir: string;
  sourceLocale: string;
}

async function manualSetup(
  defaults: { framework: Framework; format: Format; localesDir: string; sourceLocale: string } | null,
  projectLanguages: string[] = [],
): Promise<ManualConfig | null> {
  const localesDir = await p.text({
    message: "Locales directory",
    initialValue: defaults?.localesDir ?? "locales",
  });
  if (p.isCancel(localesDir)) {
    p.cancel("Cancelled.");
    return null;
  }

  let sourceLocale: string;

  if (projectLanguages.length > 0) {
    const selected = await p.select({
      message: "Source locale (primary language)",
      options: projectLanguages.map((code) => ({
        value: code,
        label: code,
      })),
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      return null;
    }
    sourceLocale = selected;
  } else {
    const typed = await p.text({
      message: "Source locale code (e.g. en_us, es_es, pt_br)",
      initialValue: defaults?.sourceLocale ?? "en_us",
      validate: (val) => {
        if (!/^[a-z]{2}([_-][a-zA-Z]{2,4})?$/.test(val)) {
          return "Invalid locale code. Examples: en_us, es_es, pt_br";
        }
      },
    });
    if (p.isCancel(typed)) {
      p.cancel("Cancelled.");
      return null;
    }
    sourceLocale = typed;
  }

  // Detect framework to recommend the best format
  const hint = defaults ? { framework: defaults.framework, format: defaults.format } : detectFramework(process.cwd());
  const recommendedFormat: Format = hint?.format ?? "nested-json";

  const format = await p.select<Format>({
    message: "File format",
    options: (Object.entries(FORMAT_LABELS) as [Format, string][]).map(([value, label]) => ({
      value,
      label: value === recommendedFormat ? `${label} (Recommended)` : label,
    })),
    initialValue: recommendedFormat,
  });
  if (p.isCancel(format)) {
    p.cancel("Cancelled.");
    return null;
  }

  return {
    framework: hint?.framework ?? defaults?.framework ?? "generic",
    format,
    localesDir,
    sourceLocale,
  };
}
