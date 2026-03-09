import fs from "node:fs";
import path from "node:path";
import type { I1nParser, Language, ParseResult, ParseWarning, Wording } from "../shared/types.js";
import { safePathSegment } from "./utils.js";

const STRING_REGEX = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;
const PLURAL_REGEX = /<plurals\s+name="([^"]+)">([\s\S]*?)<\/plurals>/g;
const PLURAL_ITEM_REGEX = /<item\s+quantity="([^"]+)">([\s\S]*?)<\/item>/g;

export const androidXmlParser: I1nParser = {
  extensions: [".xml"],

  read(localesDir: string, _sourceLocale: string): ParseResult {
    const fullDir = path.resolve(localesDir);
    const warnings: ParseWarning[] = [];

    if (!fs.existsSync(fullDir)) return { wordings: [], warnings };

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const valueDirs = entries.filter(
      (e) => e.isDirectory() && e.name.startsWith("values"),
    );

    const wordingMap = new Map<string, Wording>();

    for (const dir of valueDirs) {
      const locale = dir.name === "values" ? "en" : dir.name.replace("values-", "");
      const stringsPath = path.join(fullDir, dir.name, "strings.xml");
      if (!fs.existsSync(stringsPath)) continue;

      let content: string;
      try {
        content = fs.readFileSync(stringsPath, "utf-8");
      } catch (err) {
        warnings.push({
          file: stringsPath,
          message: `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        continue;
      }

      if (!content.includes("<resources")) {
        warnings.push({ file: stringsPath, message: "Not a valid Android resources XML file" });
        continue;
      }

      const stringRegex = new RegExp(STRING_REGEX.source, "g");
      let match: RegExpExecArray | null;

      while ((match = stringRegex.exec(content)) !== null) {
        const key = match[1];
        if (!key) continue;
        const value = unescapeXml(match[2]);
        const mapKey = `strings::${key}`;

        const existing = wordingMap.get(mapKey);
        if (existing) {
          existing.value_json[locale] = value;
        } else {
          wordingMap.set(mapKey, {
            key,
            namespace: "strings",
            value_json: { [locale]: value },
          });
        }
      }

      const pluralRegex = new RegExp(PLURAL_REGEX.source, "g");
      let pluralMatch: RegExpExecArray | null;

      while ((pluralMatch = pluralRegex.exec(content)) !== null) {
        const baseName = pluralMatch[1];
        const body = pluralMatch[2];

        const itemRegex = new RegExp(PLURAL_ITEM_REGEX.source, "g");
        let itemMatch: RegExpExecArray | null;

        while ((itemMatch = itemRegex.exec(body)) !== null) {
          const quantity = itemMatch[1];
          const value = unescapeXml(itemMatch[2]);
          const key = `${baseName}_${quantity}`;
          const mapKey = `strings::${key}`;

          const existing = wordingMap.get(mapKey);
          if (existing) {
            existing.value_json[locale] = value;
          } else {
            wordingMap.set(mapKey, {
              key,
              namespace: "strings",
              value_json: { [locale]: value },
            });
          }
        }
      }
    }

    return { wordings: Array.from(wordingMap.values()), warnings };
  },

  write(localesDir: string, wordings: Wording[], languages: Language[]): void {
    const fullDir = path.resolve(localesDir);

    for (const lang of languages) {
      const safeLang = safePathSegment(lang.code);
      const dirName = safeLang === "en" ? "values" : `values-${safeLang}`;
      const langDir = path.join(fullDir, dirName);
      fs.mkdirSync(langDir, { recursive: true });

      const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"];

      const sorted = [...wordings].sort((a, b) => a.key.localeCompare(b.key));

      for (const wording of sorted) {
        const value = wording.value_json[lang.code];
        if (value === undefined) continue;
        lines.push(`    <string name="${escapeXml(wording.key)}">${escapeXml(value)}</string>`);
      }

      lines.push("</resources>", "");

      fs.writeFileSync(
        path.join(langDir, "strings.xml"),
        lines.join("\n"),
        "utf-8",
      );
    }
  },
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
