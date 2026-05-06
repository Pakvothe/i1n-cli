import { replaceVariables } from "../shared/variables.js";
import { UNSAFE_KEYS } from "../parsers/utils.js";
// ─── Types ───────────────────────────────────────────────────────────
export type EngineFn = (key: string, params?: Record<string, any>) => string;

/**
 * Global interface for translation keys.
 * Can be augmented by generated code to provide type safety.
 */
export interface I1nKeys {}

export type I1nKey = keyof I1nKeys | (string & {});

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
    if (
      current == null ||
      typeof current !== "object" ||
      UNSAFE_KEYS.has(part)
    ) {
      current = undefined;
      break;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      current = undefined;
      break;
    }
    current = current[part];
  }

  if (typeof current === "string") return current;

  // 2. Fallback: try literal flat key lookup
  if (
    Object.prototype.hasOwnProperty.call(bundle, key) &&
    typeof bundle[key] === "string"
  ) {
    return bundle[key];
  }

  return undefined;
}

// ─── Pluralization ───────────────────────────────────────────────────

function resolvePlural(
  bundle: any,
  key: string,
  count: number,
): string | undefined {
  if (count === 0) {
    return (
      resolveKey(bundle, `${key}_zero`) ?? resolveKey(bundle, `${key}_other`)
    );
  }
  if (count === 1) {
    return (
      resolveKey(bundle, `${key}_one`) ?? resolveKey(bundle, `${key}_other`)
    );
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
 */
export function t<K extends I1nKey>(
  key: string extends K
    ? string
    : K extends keyof I1nKeys
      ? K
      : keyof I1nKeys,
  ...args: K extends keyof I1nKeys
    ? I1nKeys[K] extends Record<string, never>
      ? [options?: { defaultValue?: string }]
      : [variables: I1nKeys[K] & { defaultValue?: string }]
    : [variables?: Record<string, any> & { defaultValue?: string }]
): string {
  const variables = args[0] as
    | (Record<string, any> & { defaultValue?: string })
    | undefined;

  // Bridge mode — delegate to external engine
  if (engineFn) {
    return engineFn(key, variables);
  }

  const bundle = resources[currentLocale];
  if (!bundle) return variables?.defaultValue ?? key;

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
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    ) {
      console.warn(
        `[i1n] Missing translation: "${key}" for locale "${currentLocale}"`,
      );
    }
    return variables?.defaultValue ?? key;
  }

  return variables ? replaceVariables(value, variables) : value;
}
