import { extractVariables } from "./variables.js";
import type { Wording } from "./types.js";

export function generateTypeDefinitions(
  wordings: Wording[],
  sourceLocale: string,
): string {
  const lines: string[] = [
    "declare module \"i1n\" {",
    "  interface I1nKeys {",
  ];

  const sorted = [...wordings].sort((a, b) => {
    const ka = `${a.namespace}.${a.key}`;
    const kb = `${b.namespace}.${b.key}`;
    return ka.localeCompare(kb);
  });

  for (const wording of sorted) {
    const fullKey = `${wording.namespace}.${wording.key}`;
    const sourceText = wording.value_json[sourceLocale] ?? "";
    const vars = extractVariables(sourceText);

    if (vars.length === 0) {
      lines.push(`    "${fullKey}": Record<string, never>;`);
    } else {
      const props = vars.map((v) => `${v}: string`).join("; ");
      lines.push(`    "${fullKey}": { ${props} };`);
    }
  }

  lines.push("  }");
  lines.push("");
  lines.push("  type I1nKey = keyof I1nKeys;");
  lines.push("");
  lines.push("  function t<K extends I1nKey>(");
  lines.push("    key: K,");
  lines.push(
    "    ...args: I1nKeys[K] extends Record<string, never> ? [] : [variables: I1nKeys[K]]",
  );
  lines.push("  ): string;");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
