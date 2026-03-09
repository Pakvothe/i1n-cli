import fs from "node:fs";
import path from "node:path";
import type { I1nParser, Language, ParseResult, ParseWarning, Wording } from "../shared/types.js";
import { safePathSegment } from "./utils.js";

export const arbParser: I1nParser = {
  extensions: [".arb"],

  read(localesDir: string, _sourceLocale: string): ParseResult {
    const fullDir = path.resolve(localesDir);
    const warnings: ParseWarning[] = [];

    if (!fs.existsSync(fullDir)) return { wordings: [], warnings };

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith(".arb"));
    if (files.length === 0) return { wordings: [], warnings };

    const wordingMap = new Map<string, Wording>();
    const descriptions = new Map<string, string>();

    for (const file of files) {
      const filePath = path.join(fullDir, file);

      let content: Record<string, unknown>;
      try {
        content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (err) {
        warnings.push({
          file: filePath,
          message: `Failed to parse ARB: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        continue;
      }

      if (!content || typeof content !== "object") {
        warnings.push({ file: filePath, message: "Expected a JSON object" });
        continue;
      }

      const locale = (content["@@locale"] as string) ?? extractLocaleFromFilename(file);
      if (!locale) {
        warnings.push({ file: filePath, message: "Could not determine locale (missing @@locale and filename pattern)" });
        continue;
      }

      for (const [key, value] of Object.entries(content)) {
        if (key.startsWith("@")) {
          if (key.startsWith("@@")) continue;
          const meta = value as Record<string, unknown>;
          if (meta.description) {
            descriptions.set(key.slice(1), String(meta.description));
          }
          continue;
        }

        if (typeof value !== "string") continue;

        const mapKey = `l10n::${key}`;
        const existing = wordingMap.get(mapKey);

        if (existing) {
          existing.value_json[locale] = value;
        } else {
          wordingMap.set(mapKey, {
            key,
            namespace: "l10n",
            value_json: { [locale]: value },
          });
        }
      }
    }

    const wordings = Array.from(wordingMap.values());
    for (const w of wordings) {
      const desc = descriptions.get(w.key);
      if (desc) w.description = desc;
    }

    return { wordings, warnings };
  },

  write(localesDir: string, wordings: Wording[], languages: Language[]): void {
    const fullDir = path.resolve(localesDir);
    fs.mkdirSync(fullDir, { recursive: true });

    for (const lang of languages) {
      const arb: Record<string, unknown> = { "@@locale": lang.code };

      const sorted = [...wordings].sort((a, b) => a.key.localeCompare(b.key));

      for (const wording of sorted) {
        const value = wording.value_json[lang.code];
        if (value === undefined) continue;

        arb[wording.key] = value;

        if (wording.description) {
          arb[`@${wording.key}`] = { description: wording.description };
        }
      }

      const filePath = path.join(fullDir, `app_${safePathSegment(lang.code)}.arb`);
      fs.writeFileSync(filePath, JSON.stringify(arb, null, 2) + "\n", "utf-8");
    }
  },
};

function extractLocaleFromFilename(filename: string): string | null {
  const match = filename.match(/app_(.+)\.arb$/);
  return match?.[1] ?? null;
}
