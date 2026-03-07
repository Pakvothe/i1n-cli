import fs from "node:fs";
import path from "node:path";
import type { I1nParser, Language, ParseResult, ParseWarning, Wording } from "../shared/types.js";
import { flattenObject, unflattenObject } from "./utils.js";

const LOCALE_PATTERN = /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/;

function parseObjectLiteral(source: string): Record<string, unknown> | null {
  const cleaned = source
    .replace(/as\s+const\s*;?\s*$/, "")
    .trim();

  if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) return null;

  try {
    const jsonCompatible = cleaned
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/'/g, '"')
      .replace(/,\s*([\]}])/g, "$1");

    return JSON.parse(jsonCompatible);
  } catch {
    return null;
  }
}

export const typescriptParser: I1nParser = {
  extensions: [".ts", ".js"],

  read(localesDir: string, _sourceLocale: string): ParseResult {
    const fullDir = path.resolve(localesDir);
    const warnings: ParseWarning[] = [];

    if (!fs.existsSync(fullDir)) return { wordings: [], warnings };

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const localeDirs = entries.filter(
      (e) => e.isDirectory() && LOCALE_PATTERN.test(e.name),
    );

    if (localeDirs.length === 0) return { wordings: [], warnings };

    const wordingMap = new Map<string, Wording>();

    for (const localeDir of localeDirs) {
      const lang = localeDir.name;
      const langPath = path.join(fullDir, lang);
      const files = fs
        .readdirSync(langPath)
        .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

      for (const file of files) {
        const namespace = file.replace(/\.(ts|js)$/, "");
        if (!namespace) continue;

        const filePath = path.join(langPath, file);

        let content: string;
        try {
          content = fs.readFileSync(filePath, "utf-8");
        } catch (err) {
          warnings.push({
            file: filePath,
            message: `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`,
          });
          continue;
        }

        const exportMatch = content.match(
          /export\s+default\s+(\{[\s\S]*\})\s*(?:as\s+const)?\s*;?\s*$/,
        );
        if (!exportMatch) {
          warnings.push({ file: filePath, message: "No default export object found" });
          continue;
        }

        const parsed = parseObjectLiteral(exportMatch[1]);
        if (!parsed) {
          warnings.push({ file: filePath, message: "Could not parse the exported object literal" });
          continue;
        }

        const flat = flattenObject(parsed);

        for (const [key, value] of Object.entries(flat)) {
          if (!key) continue;
          const mapKey = `${namespace}::${key}`;
          const existing = wordingMap.get(mapKey);

          if (existing) {
            existing.value_json[lang] = value;
          } else {
            wordingMap.set(mapKey, {
              key,
              namespace,
              value_json: { [lang]: value },
            });
          }
        }
      }
    }

    return { wordings: Array.from(wordingMap.values()), warnings };
  },

  write(localesDir: string, wordings: Wording[], languages: Language[]): void {
    const fullDir = path.resolve(localesDir);

    const grouped = new Map<string, Map<string, Record<string, string>>>();

    for (const wording of wordings) {
      for (const lang of languages) {
        const value = wording.value_json[lang.code];
        if (value === undefined) continue;

        if (!grouped.has(lang.code)) {
          grouped.set(lang.code, new Map());
        }
        const langMap = grouped.get(lang.code)!;

        if (!langMap.has(wording.namespace)) {
          langMap.set(wording.namespace, {});
        }
        langMap.get(wording.namespace)![wording.key] = value;
      }
    }

    for (const [lang, namespaces] of grouped) {
      const langDir = path.join(fullDir, lang);
      fs.mkdirSync(langDir, { recursive: true });

      for (const [namespace, flat] of namespaces) {
        const nested = unflattenObject(flat);
        const json = JSON.stringify(nested, null, 2);
        const filePath = path.join(langDir, `${namespace}.ts`);
        fs.writeFileSync(filePath, `export default ${json} as const;\n`, "utf-8");
      }
    }
  },
};
