import { extractVariables } from "./variables.js";
import type { Wording } from "./types.js";

const PLURAL_SUFFIXES = ["_zero", "_one", "_other"] as const;

/** Escape special characters for use inside a TypeScript string literal. */
function escapeKey(key: string): string {
  return key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Check if a key is a plural variant (ends with _zero, _one, or _other).
 */
function getPluralBase(fullKey: string): string | null {
  for (const suffix of PLURAL_SUFFIXES) {
    if (fullKey.endsWith(suffix)) {
      return fullKey.slice(0, -suffix.length);
    }
  }
  return null;
}

export function generateTypeDefinitions(
  wordings: Wording[],
  sourceLocale: string,
): string {
  const sorted = [...wordings].sort((a, b) => {
    const ka = `${a.namespace}.${a.key}`;
    const kb = `${b.namespace}.${b.key}`;
    return ka.localeCompare(kb);
  });

  // Collect plural groups: baseKey → set of extracted variables across all variants
  const pluralGroups = new Map<string, Set<string>>();
  const pluralVariantKeys = new Set<string>();

  for (const wording of sorted) {
    const fullKey = `${wording.namespace}.${wording.key}`;
    const base = getPluralBase(fullKey);
    if (base) {
      pluralVariantKeys.add(fullKey);
      const existing = pluralGroups.get(base) ?? new Set<string>();
      const sourceText = wording.value_json[sourceLocale] ?? "";
      for (const v of extractVariables(sourceText)) {
        existing.add(v);
      }
      pluralGroups.set(base, existing);
    }
  }

  const lines: string[] = [
    "declare module \"i1n\" {",
    "  interface I1nKeys {",
  ];

  // Track which base keys we've already emitted (to avoid duplicates)
  const emittedKeys = new Set<string>();

  for (const wording of sorted) {
    const fullKey = `${wording.namespace}.${wording.key}`;

    // Skip individual plural variant keys (_zero, _one, _other)
    if (pluralVariantKeys.has(fullKey)) {
      const base = getPluralBase(fullKey)!;
      if (!emittedKeys.has(base)) {
        emittedKeys.add(base);
        const vars = pluralGroups.get(base)!;
        // Always include count: number for plural keys
        const props = ["count: number"];
        for (const v of vars) {
          if (v !== "count") props.push(`${v}: string`);
        }
        lines.push(`    "${escapeKey(base)}": { ${props.join("; ")} };`);
      }
      continue;
    }

    const sourceText = wording.value_json[sourceLocale] ?? "";
    const vars = extractVariables(sourceText);

    if (vars.length === 0) {
      lines.push(`    "${escapeKey(fullKey)}": Record<string, never>;`);
    } else {
      const props = vars.map((v) => `${v}: string`).join("; ");
      lines.push(`    "${escapeKey(fullKey)}": { ${props} };`);
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
  lines.push("");
  lines.push("  function init(options: { locale: string; resources: Record<string, any> }): void;");
  lines.push("  function setLocale(locale: string): void;");
  lines.push("  function getLocale(): string;");
  lines.push("");
  lines.push("  type EngineFn = (key: string, params?: Record<string, any>) => string;");
  lines.push("  function registerI1n(engine: EngineFn | null): void;");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
