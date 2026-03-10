import fs from "node:fs";
import path from "node:path";
import type {
  I1nParser,
  Language,
  ParseResult,
  ParseWarning,
  Wording,
} from "../shared/types.js";
import { flattenObject, unflattenObject, safePathSegment } from "./utils.js";

const LOCALE_PATTERN = /^[a-z]{2}([_-][a-zA-Z]{2,4})?$/;

export const jsonNestedParser: I1nParser = {
  extensions: [".json"],

  read(localesDir: string, sourceLocale: string): ParseResult {
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
      const files = fs.readdirSync(langPath).filter((f) => f.endsWith(".json"));

      for (const file of files) {
        const namespace = file.replace(".json", "");
        if (!namespace) continue;

        const filePath = path.join(langPath, file);

        let content: Record<string, unknown>;
        try {
          content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (err) {
          warnings.push({
            file: filePath,
            message: `Failed to parse JSON: ${err instanceof Error ? err.message : "unknown error"}`,
          });
          continue;
        }

        if (!content || typeof content !== "object" || Array.isArray(content)) {
          warnings.push({
            file: filePath,
            message: "Expected a JSON object but found a different type",
          });
          continue;
        }

        const flat = flattenObject(content);

        for (let [key, value] of Object.entries(flat)) {
          if (!key) continue;

          // Strip redundant root namespace if it matches the filename
          if (key.startsWith(`${namespace}.`)) {
            key = key.slice(namespace.length + 1);
          }

          const mapKey = `${namespace}::${key}`;
          const existing = wordingMap.get(mapKey);

          if (existing) {
            existing.value_json[lang] = value as string;
          } else {
            wordingMap.set(mapKey, {
              key,
              namespace,
              value_json: { [lang]: value as string },
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
      const langDir = path.join(fullDir, safePathSegment(lang));
      fs.mkdirSync(langDir, { recursive: true });

      for (const [namespace, flat] of namespaces) {
        const nested = unflattenObject(flat);
        const filePath = path.join(
          langDir,
          `${safePathSegment(namespace)}.json`,
        );
        fs.writeFileSync(
          filePath,
          JSON.stringify(nested, null, 2) + "\n",
          "utf-8",
        );
      }
    }
  },
};
