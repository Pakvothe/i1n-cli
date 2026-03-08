import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { I1nProjectConfig } from "./types.js";

const PROJECT_CONFIG = "i1n.config.json";

const SAFE_PATH = z.string().refine(
  (val) => !val.includes("..") && !path.isAbsolute(val),
  { message: "Path must be relative and cannot contain '..'" },
);

const LOCALE_CODE = z.string().regex(
  /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/,
  "Invalid locale code format",
);

const ProjectConfigSchema = z.object({
  apiKey: z.string().startsWith("i1n_"),
  projectId: z.string().uuid(),
  localesDir: SAFE_PATH,
  sourceLocale: LOCALE_CODE,
  format: z.enum([
    "nested-json",
    "flat-json",
    "arb",
    "yaml",
    "android-xml",
    "apple-strings",
    "typescript",
  ]),
  framework: z.enum([
    "i18next",
    "next-intl",
    "vue-i18n",
    "expo",
    "ngx-translate",
    "flutter",
    "rails",
    "android",
    "ios",
    "generic",
  ]),
});

export function readProjectConfig(
  cwd = process.cwd(),
): I1nProjectConfig | null {
  const configPath = path.join(cwd, PROJECT_CONFIG);
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return ProjectConfigSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeProjectConfig(
  config: I1nProjectConfig,
  cwd = process.cwd(),
): void {
  const configPath = path.join(cwd, PROJECT_CONFIG);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function projectConfigExists(cwd = process.cwd()): boolean {
  return fs.existsSync(path.join(cwd, PROJECT_CONFIG));
}

/**
 * Ensures i1n.config.json is in the project's .gitignore.
 * Creates .gitignore if it doesn't exist.
 */
export function ensureGitignore(cwd = process.cwd()): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  const entries = ["i1n.config.json", "**/.i1n-push-state.json"];

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    const missing = entries.filter((e) => !lines.includes(e));
    if (missing.length === 0) return;
    fs.appendFileSync(gitignorePath, `\n# i1n\n${missing.join("\n")}\n`);
  } else {
    fs.writeFileSync(gitignorePath, `# i1n\n${entries.join("\n")}\n`);
  }
}
