import fs from "node:fs";
import path from "node:path";
import type { DetectionResult, Format, Framework } from "../shared/types.js";

interface DepSignal {
  dep: string;
  framework: Framework;
  format: Format;
  dirs: string[];
}

const DEP_SIGNALS: DepSignal[] = [
  { dep: "next-intl", framework: "next-intl", format: "nested-json", dirs: ["messages", "src/messages"] },
  { dep: "react-i18next", framework: "i18next", format: "nested-json", dirs: ["public/locales", "src/locales", "locales"] },
  { dep: "i18next", framework: "i18next", format: "nested-json", dirs: ["public/locales", "src/locales", "locales"] },
  { dep: "vue-i18n", framework: "vue-i18n", format: "nested-json", dirs: ["src/i18n/locales", "src/locales", "locales"] },
  { dep: "expo-localization", framework: "expo", format: "nested-json", dirs: ["src/i18n", "src/locales", "locales", "i18n"] },
  { dep: "@ngx-translate/core", framework: "ngx-translate", format: "nested-json", dirs: ["src/assets/i18n", "assets/i18n"] },
];

const LOCALE_DIRS = [
  "public/locales",
  "src/locales",
  "locales",
  "src/i18n",
  "i18n",
  "messages",
  "src/messages",
  "lang",
  "translations",
  "src/assets/i18n",
  "assets/i18n",
  "config/locales",
  "lib/l10n",
  "app/src/main/res",
];

const LOCALE_CODE_PATTERN = /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/;

/**
 * Detects only the framework from dependencies/project files,
 * without requiring existing locale files.
 */
export function detectFramework(root: string): { framework: Framework; format: Format } | null {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const signal of DEP_SIGNALS) {
        if (signal.dep in allDeps) {
          return { framework: signal.framework, format: signal.format };
        }
      }
    } catch {
      // invalid package.json
    }
  }

  const pubspecPath = path.join(root, "pubspec.yaml");
  if (fs.existsSync(pubspecPath)) {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    if (content.includes("flutter_localizations") || content.includes("intl")) {
      return { framework: "flutter", format: "arb" };
    }
  }

  const gemfilePath = path.join(root, "Gemfile");
  if (fs.existsSync(gemfilePath)) {
    const content = fs.readFileSync(gemfilePath, "utf-8");
    if (content.includes("rails")) {
      return { framework: "rails", format: "yaml" };
    }
  }

  // Check for Android/iOS project markers
  if (fs.existsSync(path.join(root, "AndroidManifest.xml")) ||
      fs.existsSync(path.join(root, "app/src/main/AndroidManifest.xml"))) {
    return { framework: "android", format: "android-xml" };
  }

  if (fs.existsSync(path.join(root, "Info.plist")) ||
      fs.existsSync(path.join(root, "Runner.xcodeproj"))) {
    return { framework: "ios", format: "apple-strings" };
  }

  return null;
}

export function detect(root: string): DetectionResult | null {
  const fromDeps = detectFromDependencies(root);
  if (fromDeps) return fromDeps;

  const fromFiles = detectFromFileSystem(root);
  if (fromFiles) return fromFiles;

  return null;
}

function detectFromDependencies(root: string): DetectionResult | null {
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      for (const signal of DEP_SIGNALS) {
        if (signal.dep in allDeps) {
          const localesDir = findExistingDir(root, signal.dirs);
          const sourceLocale = localesDir
            ? detectSourceLocale(path.join(root, localesDir), signal.format)
            : "en";

          return {
            framework: signal.framework,
            format: signal.format,
            localesDir: localesDir ?? signal.dirs[0],
            sourceLocale,
          };
        }
      }
    } catch {
      // invalid package.json
    }
  }

  const pubspecPath = path.join(root, "pubspec.yaml");
  if (fs.existsSync(pubspecPath)) {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    if (content.includes("flutter_localizations") || content.includes("intl")) {
      return {
        framework: "flutter",
        format: "arb",
        localesDir: findExistingDir(root, ["lib/l10n"]) ?? "lib/l10n",
        sourceLocale: "en",
      };
    }
  }

  const gemfilePath = path.join(root, "Gemfile");
  if (fs.existsSync(gemfilePath)) {
    const content = fs.readFileSync(gemfilePath, "utf-8");
    if (content.includes("rails")) {
      return {
        framework: "rails",
        format: "yaml",
        localesDir: findExistingDir(root, ["config/locales"]) ?? "config/locales",
        sourceLocale: "en",
      };
    }
  }

  return null;
}

function detectFromFileSystem(root: string): DetectionResult | null {
  for (const dir of LOCALE_DIRS) {
    const fullDir = path.join(root, dir);
    if (!fs.existsSync(fullDir)) continue;

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });

    const arbFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".arb"));
    if (arbFiles.length > 0) {
      return {
        framework: "flutter",
        format: "arb",
        localesDir: dir,
        sourceLocale: detectSourceLocale(fullDir, "arb"),
      };
    }

    const ymlFiles = entries.filter((e) => e.isFile() && (e.name.endsWith(".yml") || e.name.endsWith(".yaml")));
    if (ymlFiles.length > 0 && dir.includes("config/locales")) {
      return {
        framework: "rails",
        format: "yaml",
        localesDir: dir,
        sourceLocale: detectSourceLocale(fullDir, "yaml"),
      };
    }

    const xmlDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("values"));
    if (xmlDirs.length > 0) {
      const hasStringsXml = xmlDirs.some((d) =>
        fs.existsSync(path.join(fullDir, d.name, "strings.xml")),
      );
      if (hasStringsXml) {
        return {
          framework: "android",
          format: "android-xml",
          localesDir: dir,
          sourceLocale: "en",
        };
      }
    }

    const lprojDirs = entries.filter((e) => e.isDirectory() && e.name.endsWith(".lproj"));
    if (lprojDirs.length > 0) {
      return {
        framework: "ios",
        format: "apple-strings",
        localesDir: dir,
        sourceLocale: "en",
      };
    }

    const localeDirs = entries.filter(
      (e) => e.isDirectory() && LOCALE_CODE_PATTERN.test(e.name),
    );
    if (localeDirs.length > 0) {
      const sampleDir = path.join(fullDir, localeDirs[0].name);
      const sampleFiles = fs.readdirSync(sampleDir);

      if (sampleFiles.some((f) => f.endsWith(".json"))) {
        return {
          framework: "generic",
          format: "nested-json",
          localesDir: dir,
          sourceLocale: detectSourceLocale(fullDir, "nested-json"),
        };
      }

      if (sampleFiles.some((f) => f.endsWith(".ts") || f.endsWith(".js"))) {
        return {
          framework: "generic",
          format: "typescript",
          localesDir: dir,
          sourceLocale: detectSourceLocale(fullDir, "nested-json"),
        };
      }
    }

    const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
    if (jsonFiles.length > 0) {
      const nameWithoutExt = jsonFiles[0].name.replace(".json", "");
      if (LOCALE_CODE_PATTERN.test(nameWithoutExt)) {
        return {
          framework: "generic",
          format: "nested-json",
          localesDir: dir,
          sourceLocale: detectSourceLocale(fullDir, "nested-json"),
        };
      }
    }
  }

  return null;
}

function findExistingDir(root: string, candidates: string[]): string | null {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(root, dir))) return dir;
  }
  return null;
}

function detectSourceLocale(localesDir: string, format: Format): string {
  if (!fs.existsSync(localesDir)) return "en";

  const entries = fs.readdirSync(localesDir, { withFileTypes: true });
  const priority = ["en", "en_us", "en-US", "en_US", "en-us"];

  if (format === "arb") {
    for (const prio of priority) {
      if (entries.some((e) => e.name === `app_${prio}.arb`)) return prio;
    }
    const templateArb = entries.find((e) => e.name.endsWith(".arb"));
    if (templateArb) {
      const match = templateArb.name.match(/app_(.+)\.arb/);
      return match?.[1] ?? "en";
    }
  }

  if (format === "yaml") {
    for (const prio of priority) {
      if (entries.some((e) => e.name === `${prio}.yml` || e.name === `${prio}.yaml`)) return prio;
    }
  }

  for (const prio of priority) {
    if (entries.some((e) => e.isDirectory() && e.name === prio)) return prio;
  }

  const localeDirs = entries.filter(
    (e) => e.isDirectory() && LOCALE_CODE_PATTERN.test(e.name),
  );
  if (localeDirs.length > 0) {
    let largest = localeDirs[0].name;
    let maxSize = 0;

    for (const d of localeDirs) {
      const dirPath = path.join(localesDir, d.name);
      const files = fs.readdirSync(dirPath);
      let size = 0;
      for (const f of files) {
        try {
          size += fs.statSync(path.join(dirPath, f)).size;
        } catch {
          // skip
        }
      }
      if (size > maxSize) {
        maxSize = size;
        largest = d.name;
      }
    }

    return largest;
  }

  return "en";
}
