import { replaceVariables } from "../shared/variables.js";

// ─── Types ───────────────────────────────────────────────────────────
export type EngineFn = (key: string, params?: Record<string, any>) => string;

// ─── Internal State ──────────────────────────────────────────────────
let currentLocale = "";
let resources: Record<string, any> = {};
let engineFn: EngineFn | null = null;

// ─── Key Resolution ──────────────────────────────────────────────────

/**
 * Resolve a dot-notation key against a resource bundle.
 * Tries nested navigation first, then literal flat key lookup.
 */
function resolveKey(bundle: any, key: string): string | undefined {
  if (!bundle || typeof bundle !== "object") return undefined;

  // 1. Try nested navigation: "auth.login.submit" → bundle.auth.login.submit
  const parts = key.split(".");
  let current: any = bundle;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      current = undefined;
      break;
    }
    current = current[part];
  }

  if (typeof current === "string") return current;

  // 2. Fallback: try literal flat key lookup
  if (typeof bundle[key] === "string") return bundle[key];

  return undefined;
}

// ─── Pluralization ───────────────────────────────────────────────────

function resolvePlural(
  bundle: any,
  key: string,
  count: number,
): string | undefined {
  if (count === 0) {
    return resolveKey(bundle, `${key}_zero`) ?? resolveKey(bundle, `${key}_other`);
  }
  if (count === 1) {
    return resolveKey(bundle, `${key}_one`) ?? resolveKey(bundle, `${key}_other`);
  }
  return resolveKey(bundle, `${key}_other`);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Initialize the i1n runtime with locale and resources.
 */
export function init(options: {
  locale: string;
  resources: Record<string, any>;
}): void {
  currentLocale = options.locale;
  resources = options.resources;
}

/**
 * Change the active locale at runtime.
 */
export function setLocale(locale: string): void {
  currentLocale = locale;
}

/**
 * Get the current active locale.
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Register an external translation engine (bridge mode).
 * When registered, t() delegates all translation to the engine.
 * Pass `null` to disconnect the bridge and use the native engine.
 */
export function registerI1n(engine: EngineFn | null): void {
  engineFn = engine;
}

/**
 * Translate a key with optional variable interpolation.
 *
 * Resolution order:
 * 1. If a bridge engine is registered, delegate to it
 * 2. Get resource bundle for current locale
 * 3. If variables contain `count` (number), resolve plural variant
 * 4. Otherwise resolve key directly (nested → flat fallback)
 * 5. Interpolate variables
 * 6. Return key as fallback if nothing found
 */
export function t(key: string, variables?: Record<string, any>): string {
  // Bridge mode — delegate to external engine
  if (engineFn) {
    return engineFn(key, variables);
  }

  const bundle = resources[currentLocale];
  if (!bundle) return key;

  let value: string | undefined;

  // Pluralization: check if variables has a numeric `count`
  if (variables && typeof variables.count === "number") {
    value = resolvePlural(bundle, key, variables.count);
  }

  // Standard resolution if no plural match
  if (value === undefined) {
    value = resolveKey(bundle, key);
  }

  if (value === undefined) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn(`[i1n] Missing translation: "${key}" for locale "${currentLocale}"`);
    }
    return key;
  }

  return variables ? replaceVariables(value, variables) : value;
}
