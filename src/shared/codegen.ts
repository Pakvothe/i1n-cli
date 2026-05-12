import { extractVariables } from "./variables.js";
import type { Wording } from "./types.js";

const PLURAL_SUFFIXES = ["_zero", "_one", "_other"] as const;

/** Escape special characters for use inside a TypeScript string literal. */
const ESCAPE_MAP: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
};
function escapeKey(key: string): string {
  return key.replace(/[\\"'\n\r\t\0]/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** Check if a name is a valid JS identifier (safe to use unquoted as TS property). */
const SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
function safeProp(name: string): string {
  return SAFE_IDENT.test(name) ? name : `"${escapeKey(name)}"`;
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
    const ka = a.key.startsWith(`${a.namespace}.`)
      ? a.key
      : `${a.namespace}.${a.key}`;
    const kb = b.key.startsWith(`${b.namespace}.`)
      ? b.key
      : `${b.namespace}.${b.key}`;
    return ka.localeCompare(kb);
  });

  // Helper to get the canonical full key (stripping redundant namespace)
  const getFullKey = (w: Wording) =>
    w.key.startsWith(`${w.namespace}.`) ? w.key : `${w.namespace}.${w.key}`;

  // Collect plural groups: baseKey → set of extracted variables across all variants
  const pluralGroups = new Map<string, Set<string>>();
  const pluralVariantKeys = new Set<string>();

  for (const wording of sorted) {
    const fullKey = getFullKey(wording);
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
    'import "i1n";',
    "",
    'declare module "i1n" {',
    "  interface I1nKeys {",
  ];

  // Track which keys we've already emitted. Two distinct sources of
  // collision are handled here:
  //   1. Plural base + regular literal — e.g. a wording with fullKey
  //      `common.hello` coexisting with `common.hello_one`. The plural
  //      variant carries strictly more type info (`count: number` and any
  //      additional vars), so we let it win and skip the literal twin.
  //   2. Two rows that canonicalize to the same fullKey — e.g.
  //      `(common, "common.hello")` + `(common, "hello")`. Dashboard
  //      bulk-import produced the prefixed-key form in the past. Emitting
  //      both produces a TS duplicate-property error.
  const emittedKeys = new Set<string>();

  for (const wording of sorted) {
    const fullKey = getFullKey(wording);

    // Skip individual plural variant keys (_zero, _one, _other)
    if (pluralVariantKeys.has(fullKey)) {
      const base = getPluralBase(fullKey)!;
      if (!emittedKeys.has(base)) {
        emittedKeys.add(base);
        const vars = pluralGroups.get(base)!;
        // Always include count: number for plural keys
        const props = ["count: number"];
        for (const v of vars) {
          if (v !== "count") props.push(`${safeProp(v)}: string`);
        }
        lines.push(`    "${escapeKey(base)}": { ${props.join("; ")} };`);
      }
      continue;
    }

    // A literal wording whose fullKey is also the base of some plural
    // group: skip it. The plural branch above will emit the canonical
    // entry with `count: number`. Without this guard, the literal would
    // mark the base as emitted with `Record<string, never>` and the
    // plural variant would be silently dropped.
    if (pluralGroups.has(fullKey)) {
      continue;
    }

    if (emittedKeys.has(fullKey)) {
      // Same fullKey already emitted via another wording row. The downstream
      // file writer also collapses these into one path; the type would just
      // be a duplicate so we skip it.
      continue;
    }
    emittedKeys.add(fullKey);

    const sourceText = wording.value_json[sourceLocale] ?? "";
    const vars = extractVariables(sourceText);

    if (vars.length === 0) {
      lines.push(`    "${escapeKey(fullKey)}": Record<string, never>;`);
    } else {
      const props = vars.map((v) => `${safeProp(v)}: string`).join("; ");
      lines.push(`    "${escapeKey(fullKey)}": { ${props} };`);
    }
  }

  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}
