/**
 * Normalizes a locale code to match the supported_codes list from the backend.
 *
 * Handles:
 * - Hyphen to underscore: "en-US" → "en_us"
 * - Lowercase: "en_US" → "en_us"
 * - Short codes: "en" → "en_us" (first match)
 * - Exact match: "en_us" → "en_us"
 *
 * Returns null if the code doesn't match any supported locale.
 */
export function normalizeLocaleCode(
  code: string,
  supportedCodes: string[],
): string | null {
  const normalized = code.replace(/-/g, "_").toLowerCase();

  // Exact match
  if (supportedCodes.includes(normalized)) {
    return normalized;
  }

  // Short code: find first match starting with "{code}_"
  if (!normalized.includes("_")) {
    const match = supportedCodes.find((c) => c.startsWith(`${normalized}_`));
    return match ?? null;
  }

  return null;
}

/**
 * Normalizes all language codes in a wording's value_json.
 * Returns the normalized value_json and any warnings.
 */
export function normalizeWordingLanguages(
  valueJson: Record<string, string>,
  supportedCodes: string[],
): {
  normalized: Record<string, string>;
  mappings: Map<string, string>;
  unsupported: string[];
} {
  const normalized: Record<string, string> = {};
  const mappings = new Map<string, string>();
  const unsupported: string[] = [];

  for (const [code, value] of Object.entries(valueJson)) {
    const resolved = normalizeLocaleCode(code, supportedCodes);
    if (resolved) {
      normalized[resolved] = value;
      if (resolved !== code) {
        mappings.set(code, resolved);
      }
    } else {
      unsupported.push(code);
    }
  }

  return { normalized, mappings, unsupported };
}
