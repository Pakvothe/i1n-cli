import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { I1nParser, Language, ParseResult, ParseWarning, Wording } from "../shared/types.js";
import { flattenObject, unflattenObject, UNSAFE_KEYS, safePathSegment } from "./utils.js";

export const yamlParser: I1nParser = {
  extensions: [".yml", ".yaml"],

  read(localesDir: string, _sourceLocale: string): ParseResult {
    const fullDir = path.resolve(localesDir);
    const warnings: ParseWarning[] = [];

    if (!fs.existsSync(fullDir)) return { wordings: [], warnings };

    const files = fs
      .readdirSync(fullDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

    const wordingMap = new Map<string, Wording>();

    for (const file of files) {
      const filePath = path.join(fullDir, file);

      let content: Record<string, unknown>;
      try {
        content = YAML.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (err) {
        warnings.push({
          file: filePath,
          message: `Failed to parse YAML: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        continue;
      }

      if (!content || typeof content !== "object") {
        warnings.push({ file: filePath, message: "Expected a YAML object" });
        continue;
      }

      const rootKeys = Object.keys(content);
      if (rootKeys.length === 0) continue;

      const locale = rootKeys[0];
      const translations = content[locale];
      if (!translations || typeof translations !== "object") {
        warnings.push({ file: filePath, message: `Root key "${locale}" does not contain an object` });
        continue;
      }

      const flat = flattenObject(translations as Record<string, unknown>);

      for (const [key, value] of Object.entries(flat)) {
        const dotIdx = key.indexOf(".");
        const namespace = dotIdx > -1 ? key.substring(0, dotIdx) : "default";
        const actualKey = dotIdx > -1 ? key.substring(dotIdx + 1) : key;
        const mapKey = `${namespace}::${actualKey}`;

        const existing = wordingMap.get(mapKey);
        if (existing) {
          existing.value_json[locale] = value;
        } else {
          wordingMap.set(mapKey, {
            key: actualKey,
            namespace,
            value_json: { [locale]: value },
          });
        }
      }
    }

    return { wordings: Array.from(wordingMap.values()), warnings };
  },

  write(localesDir: string, wordings: Wording[], languages: Language[]): void {
    const fullDir = path.resolve(localesDir);
    fs.mkdirSync(fullDir, { recursive: true });

    for (const lang of languages) {
      const nested: Record<string, unknown> = {};

      for (const wording of wordings) {
        const value = wording.value_json[lang.code];
        if (value === undefined) continue;

        const fullKey = `${wording.namespace}.${wording.key}`;
        const parts = fullKey.split(".");
        let current = nested;
        let skip = false;

        for (let i = 0; i < parts.length - 1; i++) {
          if (UNSAFE_KEYS.has(parts[i])) { skip = true; break; }
          if (!(parts[i] in current)) {
            current[parts[i]] = {};
          }
          current = current[parts[i]] as Record<string, unknown>;
        }
        const lastPart = parts[parts.length - 1];
        if (!skip && !UNSAFE_KEYS.has(lastPart)) {
          current[lastPart] = value;
        }
      }

      const doc = { [lang.code]: unflattenObject(flattenObject(nested as Record<string, unknown>)) };
      const filePath = path.join(fullDir, `${safePathSegment(lang.code)}.yml`);
      fs.writeFileSync(filePath, YAML.stringify(doc, { indent: 2 }), "utf-8");
    }
  },
};
