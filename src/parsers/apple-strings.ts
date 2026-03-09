import fs from "node:fs";
import path from "node:path";
import type { I1nParser, Language, ParseResult, ParseWarning, Wording } from "../shared/types.js";
import { safePathSegment } from "./utils.js";

const ENTRY_REGEX = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*;/gm;
const COMMENT_REGEX = /\/\*\s*(.*?)\s*\*\/\s*\n\s*"([^"]+)"/g;

export const appleStringsParser: I1nParser = {
  extensions: [".strings"],

  read(localesDir: string, _sourceLocale: string): ParseResult {
    const fullDir = path.resolve(localesDir);
    const warnings: ParseWarning[] = [];

    if (!fs.existsSync(fullDir)) return { wordings: [], warnings };

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const lprojDirs = entries.filter(
      (e) => e.isDirectory() && e.name.endsWith(".lproj"),
    );

    const wordingMap = new Map<string, Wording>();
    const descriptions = new Map<string, string>();

    for (const dir of lprojDirs) {
      const locale = dir.name.replace(".lproj", "");
      const stringsPath = path.join(fullDir, dir.name, "Localizable.strings");
      if (!fs.existsSync(stringsPath)) continue;

      let raw: Buffer;
      try {
        raw = fs.readFileSync(stringsPath);
      } catch (err) {
        warnings.push({
          file: stringsPath,
          message: `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        continue;
      }

      const content =
        raw[0] === 0xff || raw[0] === 0xfe
          ? raw.toString("utf16le").replace(/^\uFEFF/, "")
          : raw.toString("utf-8").replace(/^\uFEFF/, "");

      const commentRegex = new RegExp(COMMENT_REGEX.source, "g");
      let commentMatch: RegExpExecArray | null;
      while ((commentMatch = commentRegex.exec(content)) !== null) {
        descriptions.set(commentMatch[2], commentMatch[1]);
      }

      const entryRegex = new RegExp(ENTRY_REGEX.source, "gm");
      let match: RegExpExecArray | null;
      let foundEntries = false;

      while ((match = entryRegex.exec(content)) !== null) {
        foundEntries = true;
        const key = unescapeStrings(match[1]);
        const value = unescapeStrings(match[2]);
        const mapKey = `localizable::${key}`;

        const existing = wordingMap.get(mapKey);
        if (existing) {
          existing.value_json[locale] = value;
        } else {
          wordingMap.set(mapKey, {
            key,
            namespace: "localizable",
            value_json: { [locale]: value },
          });
        }
      }

      if (!foundEntries && content.trim().length > 0) {
        warnings.push({ file: stringsPath, message: "File is not empty but no valid entries were found" });
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

    for (const lang of languages) {
      const langDir = path.join(fullDir, `${safePathSegment(lang.code)}.lproj`);
      fs.mkdirSync(langDir, { recursive: true });

      const lines: string[] = [];
      const sorted = [...wordings].sort((a, b) => a.key.localeCompare(b.key));

      for (const wording of sorted) {
        const value = wording.value_json[lang.code];
        if (value === undefined) continue;

        if (wording.description) {
          lines.push(`/* ${wording.description.replace(/\*\//g, "* /")} */`);
        }
        lines.push(`"${escapeStrings(wording.key)}" = "${escapeStrings(value)}";`);
        lines.push("");
      }

      fs.writeFileSync(
        path.join(langDir, "Localizable.strings"),
        lines.join("\n"),
        "utf-8",
      );
    }
  },
};

function escapeStrings(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function unescapeStrings(text: string): string {
  return text.replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\"/g, '"');
}
