const MAX_DEPTH = 50;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
  depth = 0,
): Record<string, string> {
  if (depth > MAX_DEPTH) return {};
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!key || UNSAFE_KEYS.has(key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[fullKey] = String(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey, depth + 1));
    }
  }

  return result;
}

export function unflattenObject(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const keys = Object.keys(flat).sort((a, b) => {
    const aParts = a.split(".").length;
    const bParts = b.split(".").length;
    return aParts - bParts || a.localeCompare(b);
  });

  for (const key of keys) {
    const parts = key.split(".");
    if (parts.length > MAX_DEPTH) continue;

    let current = result;
    let conflict = false;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (UNSAFE_KEYS.has(part)) { conflict = true; break; }
      const existing = current[part];

      if (existing === undefined) {
        current[part] = {};
      } else if (typeof existing !== "object" || existing === null) {
        conflict = true;
        break;
      }

      current = current[part] as Record<string, unknown>;
    }

    if (!conflict) {
      const lastPart = parts[parts.length - 1];
      if (!UNSAFE_KEYS.has(lastPart) && typeof current[lastPart] !== "object") {
        current[lastPart] = flat[key];
      }
    }
  }

  return result;
}
