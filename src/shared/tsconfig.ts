import fs from "node:fs";
import path from "node:path";

/**
 * Ensures that the locales directory is included in tsconfig.json or jsconfig.json
 * for proper IDE type support and autocompletion.
 */
export function ensureConfigInclude(
  localesDir: string,
  cwd = process.cwd(),
): void {
  // Check both tsconfig.json and jsconfig.json
  const configs = ["tsconfig.json", "jsconfig.json"];

  for (const filename of configs) {
    const configPath = path.join(cwd, filename);
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const pattern = `${localesDir}/**/*`;

      // Avoid double entries
      if (content.includes(pattern)) continue;

      // Try to find the "include" array using a simple regex that preserves formatting/comments
      const includeRegex = /"include"\s*:\s*\[([\s\S]*?)\]/;
      const match = content.match(includeRegex);

      if (match) {
        let items = match[1].trim();
        // Handle trailing commas or empty arrays
        const needsComma = items.length > 0 && !items.endsWith(",");
        const entry = `"${pattern}"`;

        const newInclude = `"include": [\n    ${items}${needsComma ? "," : ""}\n    ${entry}\n  ]`;
        const newContent = content.replace(match[0], newInclude);
        fs.writeFileSync(configPath, newContent, "utf-8");
      } else {
        // No "include" array found, append it at the end before the last closing brace
        const lastBraceIndex = content.lastIndexOf("}");
        if (lastBraceIndex !== -1) {
          const prefix = content.slice(0, lastBraceIndex).trimEnd();
          const suffix = content.slice(lastBraceIndex);
          const needsSeparator = prefix.endsWith(",") ? "" : ",";
          const newContent = `${prefix}${needsSeparator}\n  "include": ["${pattern}"]\n${suffix}`;
          fs.writeFileSync(configPath, newContent, "utf-8");
        }
      }
    } catch (err) {
      // Fail silently for config updates, as it's a non-critical DX improvement
      console.error(`Failed to update ${filename}:`, err);
    }
  }
}
