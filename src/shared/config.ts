import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { I1nCredentials, I1nProjectConfig } from "./types.js";

const GLOBAL_DIR = path.join(os.homedir(), ".i1n");
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, "config.json");
const PROJECT_CONFIG = "i1n.config.json";

const CredentialsSchema = z.object({
  api_key: z.string().startsWith("i1n_"),
  project_id: z.string().uuid(),
});

const SAFE_PATH = z.string().refine(
  (val) => !val.includes("..") && !path.isAbsolute(val),
  { message: "Path must be relative and cannot contain '..'" },
);

const LOCALE_CODE = z.string().regex(
  /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/,
  "Invalid locale code format",
);

const ProjectConfigSchema = z.object({
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

export function readCredentials(): I1nCredentials | null {
  if (!fs.existsSync(GLOBAL_CONFIG)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(GLOBAL_CONFIG, "utf-8"));
    return CredentialsSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeCredentials(creds: I1nCredentials): void {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  const tmp = `${GLOBAL_CONFIG}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), "utf-8");
  fs.renameSync(tmp, GLOBAL_CONFIG);
}

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
