import fs from "node:fs";
import path from "node:path";
import { detect, detectFramework } from "../../detector/index.js";
import { readProjectConfig, writeProjectConfig, ensureGitignore } from "../../shared/config.js";
import { getParser } from "../../parsers/index.js";
import { callCliSync } from "../../shared/supabase.js";
import type { Format, Framework, I1nProjectConfig } from "../../shared/types.js";
import { text } from "./helpers.js";

const API_KEY_REGEX = /^i1n_[a-f0-9]{32}$/;
const LOCALE_CODE_REGEX = /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/;
const NPM_PACKAGE_REGEX = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const MAX_FS_ENTRIES_FOR_EXT_DETECTION = 500;

interface SetupBridgeParams {
  write?: boolean;
  bridgePath?: string;
  cwd?: string;
  apiKey?: string;
  projectId?: string;
  overwrite?: boolean;
}

interface BridgeSnippet {
  imports: string;
  body: string;
  hint?: string;
}

const KNOWN_BRIDGES: Record<string, BridgeSnippet> = {
  i18next: {
    imports: `import i18next from "i18next";\nimport { registerI1n } from "i1n";`,
    body: `registerI1n((key, params) => i18next.t(key, params));`,
    hint: "Call setupI1nBridge() once after i18next.init() in your app entry point.",
  },
  "next-intl": {
    imports: `import { registerI1n } from "i1n";\n// next-intl is hook-based; register inside a client setup boundary.`,
    body: `// Call inside a client component after obtaining \`t\`:\n  // const t = useTranslations();\n  // registerI1n((key, params) => t(key, params as Record<string, string | number | Date>));`,
    hint: "next-intl exposes useTranslations() as a hook, so the bridge must be registered from a client component (or a setup hook). The snippet above is a template — adapt to your client boundary.",
  },
  "vue-i18n": {
    imports: `import { i18n } from "./i18n";\nimport { registerI1n } from "i1n";`,
    body: `registerI1n((key, params) => String(i18n.global.t(key, params ?? {})));`,
    hint: "Update the import path of `i18n` to where you create the createI18n() instance. Call setupI1nBridge() once after the instance is created.",
  },
  expo: {
    imports: `import i18next from "i18next";\nimport { registerI1n } from "i1n";`,
    body: `registerI1n((key, params) => i18next.t(key, params));`,
    hint: "Expo projects commonly pair expo-localization with i18next; adjust the import if you use a different translator.",
  },
  "ngx-translate": {
    imports: `import { TranslateService } from "@ngx-translate/core";\nimport { registerI1n } from "i1n";`,
    body: `// Inject TranslateService where you bootstrap the app and call:\n  // registerI1n((key, params) => translate.instant(key, params));`,
    hint: "Angular DI: register the bridge once during app bootstrap (e.g., from APP_INITIALIZER) using the TranslateService instance.",
  },
  generic: {
    imports: `import { registerI1n } from "i1n";`,
    body: `registerI1n((key) => myCustomLookup(key));`,
    hint: "Wire registerI1n() to whatever lookup function returns translated strings in your runtime.",
  },
};

const NON_JS_FRAMEWORKS = new Set<Framework>(["flutter", "rails", "android", "ios"]);

const I18N_DEP_REGEX = /(i18n|intl|locale|translate|lingui|polyglot)/i;

function isSafeRelativePath(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (path.isAbsolute(candidate)) return false;
  const normalized = path.normalize(candidate);
  if (normalized.startsWith("..")) return false;
  const segments = normalized.split(path.sep);
  return !segments.includes("..");
}

function isPathInsideCwd(cwd: string, target: string): boolean {
  const cwdResolved = path.resolve(cwd);
  const targetResolved = path.resolve(cwd, target);
  const relative = path.relative(cwdResolved, targetResolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isValidNpmPackageName(name: string): boolean {
  return typeof name === "string" && name.length > 0 && name.length <= 214 && NPM_PACKAGE_REGEX.test(name);
}

function readPackageDeps(cwd: string): Record<string, string> {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

const KNOWN_DEPS = new Set<string>([
  "i18next",
  "react-i18next",
  "next-intl",
  "vue-i18n",
  "expo-localization",
  "@ngx-translate/core",
]);

function findUnknownI18nDep(cwd: string): string | null {
  const deps = readPackageDeps(cwd);
  for (const dep of Object.keys(deps)) {
    if (KNOWN_DEPS.has(dep)) continue;
    if (!isValidNpmPackageName(dep)) continue;
    if (I18N_DEP_REGEX.test(dep)) return dep;
  }
  return null;
}

function inferSnippet(dep: string): BridgeSnippet {
  // Caller guarantees `dep` is a valid npm package name (validated in findUnknownI18nDep
  // or against the framework enum). Even so, derive `importName` deterministically.
  const lower = dep.toLowerCase();
  const safeImportName = dep.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
  const importName = /^[a-zA-Z_]/.test(safeImportName) ? safeImportName : `_${safeImportName}`;

  const isHookFlavor = /-react$|-vue$|-svelte$|-solid$/.test(lower);
  if (isHookFlavor) {
    return {
      imports: `// TODO verify with ${dep} docs\nimport { registerI1n } from "i1n";\n// import { /* hook from ${dep} */ } from "${dep}";`,
      body: `// ${dep} appears to expose a hook. Register the bridge from inside a component:\n  // const t = useTranslationHook();\n  // registerI1n((key, params) => t(key, params));`,
      hint: `Inferred: ${dep} looks hook-based. Verify the hook's name and signature in the library docs.`,
    };
  }

  if (lower.includes("intl")) {
    return {
      imports: `// TODO verify with ${dep} docs\nimport { registerI1n } from "i1n";\n// import { /* intl factory */ } from "${dep}";`,
      body: `// Assumes a formatMessage-style API (react-intl / formatjs). Adapt to your setup:\n  // registerI1n((key, params) => intl.formatMessage({ id: key }, params));`,
      hint: `Inferred: ${dep} contains "intl" — assumed formatMessage({ id }, params) API. Verify against the library docs.`,
    };
  }

  return {
    imports: `// TODO verify with ${dep} docs\nimport * as ${importName} from "${dep}";\nimport { registerI1n } from "i1n";`,
    body: `// Assumes a t(key, params) API. Adjust if the library uses a different function name.\n  registerI1n((key, params) => ${importName}.t(key, params));`,
    hint: `Inferred: ${dep} — assumed t(key, params) API. Common alternatives: translate(), formatMessage(). Verify against the library docs.`,
  };
}

function decideBridgeExtension(cwd: string): "ts" | "js" {
  if (fs.existsSync(path.join(cwd, "tsconfig.json"))) return "ts";
  const srcDir = path.join(cwd, "src");
  if (!fs.existsSync(srcDir)) return "js";
  // Bounded BFS: avoid traversing huge monorepos or symlink loops. Symlinks are
  // not followed because Dirent.isDirectory() returns false for them.
  let entriesScanned = 0;
  try {
    const stack: string[] = [srcDir];
    while (stack.length > 0 && entriesScanned < MAX_FS_ENTRIES_FOR_EXT_DETECTION) {
      const dir = stack.pop()!;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        entriesScanned++;
        if (entriesScanned >= MAX_FS_ENTRIES_FOR_EXT_DETECTION) break;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          stack.push(path.join(dir, entry.name));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          return "ts";
        }
      }
    }
  } catch {
    // ignore traversal errors (permissions, vanished entries, etc.)
  }
  return "js";
}

function buildBridgeFile(snippet: BridgeSnippet, ext: "ts" | "js", framework: string, inferred: boolean): string {
  const safeFramework = isValidNpmPackageName(framework) ? framework : "unknown";
  const header = inferred
    ? `// src/i18n/i1n-bridge.${ext} — autogenerated by i1n MCP (best-effort inference)\n// Verify the registerI1n() call against the library's translation API.`
    : `// src/i18n/i1n-bridge.${ext} — autogenerated by i1n MCP (framework: ${safeFramework})`;
  return `${header}\n${snippet.imports}\n\nexport function setupI1nBridge() {\n  ${snippet.body}\n}\n`;
}

interface ResolvedBridgeTarget {
  ok: true;
  absolutePath: string;
  relativePath: string;
  ext: "ts" | "js";
}
interface BridgeTargetError {
  ok: false;
  status: string;
  payload: Record<string, unknown>;
}

function resolveBridgeTarget(cwd: string, requestedPath: string | undefined): ResolvedBridgeTarget | BridgeTargetError {
  const fallback = `src/i18n/i1n-bridge.${decideBridgeExtension(cwd)}`;
  const candidate = requestedPath ?? fallback;

  if (!isSafeRelativePath(candidate)) {
    return {
      ok: false,
      status: "invalid_bridge_path",
      payload: {
        message: "bridgePath must be a relative path inside the project (no absolute paths, no '..').",
        rejectedPath: candidate,
      },
    };
  }

  const ext = path.extname(candidate).toLowerCase();
  if (ext !== ".ts" && ext !== ".js") {
    return {
      ok: false,
      status: "invalid_bridge_path",
      payload: {
        message: "bridgePath must end with '.ts' or '.js'.",
        rejectedPath: candidate,
      },
    };
  }

  const absolutePath = path.resolve(cwd, candidate);
  if (!isPathInsideCwd(cwd, candidate)) {
    return {
      ok: false,
      status: "invalid_bridge_path",
      payload: {
        message: "bridgePath resolves outside the project root.",
        rejectedPath: candidate,
      },
    };
  }

  return { ok: true, absolutePath, relativePath: candidate, ext: ext === ".ts" ? "ts" : "js" };
}

type WriteBridgeResult =
  | { written: true; overwrote: boolean }
  | { written: false; refused: true; existingPath: string };

function writeBridgeArtifact(
  target: ResolvedBridgeTarget,
  snippet: BridgeSnippet,
  framework: string,
  inferred: boolean,
  overwrite: boolean,
): WriteBridgeResult {
  const exists = fs.existsSync(target.absolutePath);
  if (exists && !overwrite) {
    return { written: false, refused: true, existingPath: target.relativePath };
  }
  fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
  fs.writeFileSync(target.absolutePath, buildBridgeFile(snippet, target.ext, framework, inferred), "utf-8");
  return { written: true, overwrote: exists };
}

interface InitOutcome {
  ok: boolean;
  config?: I1nProjectConfig;
  inited?: { orgName: string; projectName: string; projectId: string };
  payload?: Record<string, unknown>;
  payloadStatus?: string;
}

async function attemptInit(
  cwd: string,
  apiKey: string,
  projectId: string | undefined,
  detectedFramework: Framework,
  detectedFormat: Format,
  localesDir: string,
  sourceLocale: string,
): Promise<InitOutcome> {
  if (typeof apiKey !== "string" || !API_KEY_REGEX.test(apiKey)) {
    return {
      ok: false,
      payloadStatus: "invalid_api_key",
      payload: {
        message: "API key format is invalid. Expected pattern: i1n_<32 hex chars>.",
        hint: "Find or create your i1n API key in the dashboard, then call this tool again with the apiKey param.",
      },
    };
  }

  if (!isSafeRelativePath(localesDir)) {
    return {
      ok: false,
      payloadStatus: "invalid_locales_dir",
      payload: {
        message: "Detected localesDir is not a safe relative path.",
        rejectedPath: localesDir,
      },
    };
  }
  if (!LOCALE_CODE_REGEX.test(sourceLocale)) {
    return {
      ok: false,
      payloadStatus: "invalid_source_locale",
      payload: {
        message: "Detected sourceLocale does not match the expected pattern.",
        rejectedLocale: sourceLocale,
      },
    };
  }

  let validateResult;
  try {
    validateResult = await callCliSync("validate", {}, apiKey);
  } catch (err) {
    return {
      ok: false,
      payloadStatus: "api_key_validation_failed",
      payload: {
        message: err instanceof Error ? err.message : "Failed to validate i1n API key.",
        hint: "Verify the API key is correct and that the i1n backend is reachable.",
      },
    };
  }

  const projects = validateResult.projects ?? [];
  if (projects.length === 0) {
    return {
      ok: false,
      payloadStatus: "no_projects",
      payload: {
        orgName: validateResult.org_name,
        message: "Authenticated, but no i1n projects exist in this organization.",
        hint: "Create a project in the i1n dashboard, then re-run this tool.",
      },
    };
  }

  let chosen = projects[0];
  if (projectId) {
    const found = projects.find((p) => p.id === projectId);
    if (!found) {
      return {
        ok: false,
        payloadStatus: "unknown_project_id",
        payload: {
          message: `Project '${projectId}' not found in this organization.`,
          availableProjects: projects.map((p) => ({ id: p.id, name: p.name, isLocked: p.is_locked })),
        },
      };
    }
    chosen = found;
  } else if (projects.length > 1) {
    return {
      ok: false,
      payloadStatus: "multiple_projects",
      payload: {
        orgName: validateResult.org_name,
        message: "Multiple projects found. Pick one and call this tool again passing `projectId`.",
        availableProjects: projects.map((p) => ({ id: p.id, name: p.name, isLocked: p.is_locked })),
      },
    };
  }

  if (chosen.is_locked) {
    return {
      ok: false,
      payloadStatus: "project_locked",
      payload: {
        message: `Project '${chosen.name}' is locked (read-only) due to plan limits.`,
        hint: "Upgrade the project's plan in the i1n dashboard or pick a different project.",
      },
    };
  }

  const newConfig: I1nProjectConfig = {
    apiKey,
    projectId: chosen.id,
    localesDir,
    sourceLocale,
    format: detectedFormat,
    framework: detectedFramework,
  };

  const localesPath = path.resolve(cwd, localesDir);
  if (!isPathInsideCwd(cwd, localesDir)) {
    return {
      ok: false,
      payloadStatus: "invalid_locales_dir",
      payload: {
        message: "Detected localesDir resolves outside the project root.",
        rejectedPath: localesDir,
      },
    };
  }
  if (!fs.existsSync(localesPath)) {
    fs.mkdirSync(localesPath, { recursive: true });
  }

  writeProjectConfig(newConfig, cwd);
  ensureGitignore(cwd);

  return {
    ok: true,
    config: newConfig,
    inited: { orgName: validateResult.org_name, projectName: chosen.name, projectId: chosen.id },
  };
}

function countKeysAndNamespaces(cwd: string, _framework: Framework, format: Format, localesDir: string, sourceLocale: string): { keys: number; namespaces: number; warnings: number } | null {
  try {
    if (!isSafeRelativePath(localesDir) && !path.isAbsolute(localesDir)) return null;
    const parser = getParser(format);
    const absDir = path.isAbsolute(localesDir) ? localesDir : path.resolve(cwd, localesDir);
    if (!fs.existsSync(absDir)) return { keys: 0, namespaces: 0, warnings: 0 };
    const result = parser.read(absDir, sourceLocale);
    const namespaces = new Set(result.wordings.map((w) => w.namespace));
    return {
      keys: result.wordings.length,
      namespaces: namespaces.size,
      warnings: result.warnings.length,
    };
  } catch {
    return null;
  }
}

export async function handleSetupBridge(params: SetupBridgeParams = {}) {
  const cwd = params.cwd ?? process.cwd();
  const writeFile = params.write === true;

  const detection = detect(cwd);
  const frameworkOnly = detection ?? detectFramework(cwd);
  const config = readProjectConfig(cwd);

  // Case: no library detected anywhere
  if (!frameworkOnly) {
    const unknownDep = findUnknownI18nDep(cwd);
    if (!unknownDep) {
      return text(JSON.stringify({
        status: "no_library",
        message: "No i18n library detected in this project.",
        recommendation: "Use i1n in native mode. Run `i1n init` from your terminal to set up.",
        configExists: config !== null,
      }, null, 2));
    }

    // Unknown library + no config → run non-interactive init if apiKey was provided, else ask for it
    let activeConfig = config;
    let initInfo: InitOutcome["inited"] | undefined;
    if (!activeConfig) {
      if (!params.apiKey) {
        return text(JSON.stringify({
          status: "needs_api_key",
          detectedDependency: unknownDep,
          inferred: true,
          confidence: "low",
          message: `Detected unknown i18n-like dependency '${unknownDep}'. To configure i1n + bridge in one step, call this tool again with the apiKey parameter.`,
          hint: "Get your API key from the i1n dashboard. The tool will run init non-interactively (validate, pick project, write i1n.config.json) and then wire up the bridge. If multiple projects exist, you may also pass projectId.",
          alternative: "You can also run `i1n init` interactively from your terminal and then call this tool again.",
        }, null, 2));
      }
      const initOutcome = await attemptInit(cwd, params.apiKey, params.projectId, "generic", "nested-json", "src/locales", "en");
      if (!initOutcome.ok) {
        return text(JSON.stringify({ status: initOutcome.payloadStatus, ...initOutcome.payload }, null, 2));
      }
      activeConfig = initOutcome.config!;
      initInfo = initOutcome.inited;
    }

    // Unknown library + config (existing or freshly written) → infer bridge
    const snippet = inferSnippet(unknownDep);
    const target = resolveBridgeTarget(cwd, params.bridgePath);
    if (!target.ok) {
      return text(JSON.stringify({ status: target.status, ...target.payload }, null, 2));
    }
    let written = false;
    let overwrote = false;
    if (writeFile) {
      const result = writeBridgeArtifact(target, snippet, unknownDep, true, params.overwrite === true);
      if (!result.written) {
        return text(JSON.stringify({
          status: "bridge_overwrite_refused",
          message: `Bridge file already exists at '${result.existingPath}'. Refusing to overwrite by default.`,
          existingPath: result.existingPath,
          hint: "Pass overwrite: true to replace the existing file, or pass a different bridgePath.",
        }, null, 2));
      }
      written = true;
      overwrote = result.overwrote;
    }
    return text(JSON.stringify({
      status: "ready_for_bridge_inferred",
      detectedDependency: unknownDep,
      inferred: true,
      confidence: "low",
      framework: activeConfig.framework,
      ...(initInfo ? { initCompleted: initInfo } : {}),
      bridge: {
        snippet: `${snippet.imports}\n\n${snippet.body}`,
        suggestedPath: target.relativePath,
        written,
        overwrote,
        appEntryHint: snippet.hint,
      },
      verificationHint:
        "This snippet is a best-effort inference. Verify the library's translation API (function name and signature) against its docs before using. Common variations: t(), translate(), formatMessage().",
    }, null, 2));
  }

  const detectedFramework = frameworkOnly.framework;

  // Case: non-JS framework — bridge does not apply
  if (NON_JS_FRAMEWORKS.has(detectedFramework)) {
    return text(JSON.stringify({
      status: "library_not_js_ts",
      framework: detectedFramework,
      message: `Bridge mode applies to JS/TS i18n libraries only. Detected: ${detectedFramework}.`,
      recommendation: "Use i1n in native mode for this stack. Run `i1n init` from your terminal.",
      configExists: config !== null,
    }, null, 2));
  }

  // Case: JS library detected, no config yet → init (if apiKey provided) or ask for apiKey
  let activeConfig = config;
  let initInfo: InitOutcome["inited"] | undefined;
  if (!activeConfig) {
    const counts = detection
      ? countKeysAndNamespaces(cwd, detectedFramework, detection.format, detection.localesDir, detection.sourceLocale)
      : null;
    if (!params.apiKey) {
      return text(JSON.stringify({
        status: "needs_api_key",
        framework: detectedFramework,
        format: detection?.format ?? frameworkOnly.format,
        localesDir: detection?.localesDir ?? null,
        sourceLocale: detection?.sourceLocale ?? null,
        analysis: counts,
        message: `Detected ${detectedFramework}, but i1n is not initialized yet.`,
        hint: "To configure i1n + bridge in one step, call this tool again with the apiKey parameter (find it in the i1n dashboard). If your organization has multiple projects, you may also pass projectId.",
        alternative: "You can also run `i1n init` interactively from your terminal and then call this tool again.",
      }, null, 2));
    }
    const fmt: Format = detection?.format ?? frameworkOnly.format;
    const localesDir = detection?.localesDir ?? "src/locales";
    const sourceLocale = detection?.sourceLocale ?? "en";
    const initOutcome = await attemptInit(cwd, params.apiKey, params.projectId, detectedFramework, fmt, localesDir, sourceLocale);
    if (!initOutcome.ok) {
      return text(JSON.stringify({ status: initOutcome.payloadStatus, ...initOutcome.payload }, null, 2));
    }
    activeConfig = initOutcome.config!;
    initInfo = initOutcome.inited;
  }

  // Case: JS library detected + config present → ready for bridge
  const effectiveFramework = activeConfig.framework;
  const mismatch = effectiveFramework !== detectedFramework ? {
    detected: detectedFramework,
    configured: effectiveFramework,
    note: "Config framework differs from detected. Using configured framework as source of truth.",
  } : null;

  const known = KNOWN_BRIDGES[effectiveFramework];
  const inferred = !known;
  // For inferred (config has a framework not in our known list), only proceed if it
  // looks like a valid identifier — otherwise fall back to the generic snippet to
  // avoid ever interpolating an unsanitized framework string into emitted code.
  const snippet = known
    ?? (isValidNpmPackageName(effectiveFramework) ? inferSnippet(effectiveFramework) : KNOWN_BRIDGES.generic);

  const counts = countKeysAndNamespaces(cwd, effectiveFramework, activeConfig.format, activeConfig.localesDir, activeConfig.sourceLocale);
  const target = resolveBridgeTarget(cwd, params.bridgePath);
  if (!target.ok) {
    return text(JSON.stringify({ status: target.status, ...target.payload }, null, 2));
  }
  let written = false;
  let overwrote = false;
  if (writeFile) {
    const result = writeBridgeArtifact(target, snippet, effectiveFramework, inferred, params.overwrite === true);
    if (!result.written) {
      return text(JSON.stringify({
        status: "bridge_overwrite_refused",
        message: `Bridge file already exists at '${result.existingPath}'. Refusing to overwrite by default.`,
        existingPath: result.existingPath,
        hint: "Pass overwrite: true to replace the existing file, or pass a different bridgePath.",
      }, null, 2));
    }
    written = true;
    overwrote = result.overwrote;
  }

  return text(JSON.stringify({
    status: inferred ? "ready_for_bridge_inferred" : "ready_for_bridge",
    framework: effectiveFramework,
    format: activeConfig.format,
    localesDir: activeConfig.localesDir,
    sourceLocale: activeConfig.sourceLocale,
    analysis: counts,
    mismatch,
    inferred,
    confidence: inferred ? "low" : "high",
    ...(initInfo ? { initCompleted: initInfo } : {}),
    bridge: {
      snippet: `${snippet.imports}\n\n${snippet.body}`,
      suggestedPath: target.relativePath,
      written,
      overwrote,
      appEntryHint: snippet.hint,
    },
    ...(inferred ? {
      verificationHint:
        "This snippet is a best-effort inference. Verify the library's translation API (function name and signature) against its docs before using.",
    } : {}),
  }, null, 2));
}
