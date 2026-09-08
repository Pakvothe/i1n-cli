/**
 * Project constants ("global variables").
 *
 * The server stores `{@NAME}` markers verbatim inside wording values and
 * exposes the NAME → value map. Apps must never see a marker, so the CLI
 * expands markers when it writes locale files (`pull`) and contracts them
 * back before diffing/pushing edited files (`push`). Contraction is
 * targeted: only the constants a (key, lang) referenced on the server are
 * contracted, using the values that were expanded at the time, so a user
 * typing the literal value into an unrelated key keeps their literal text.
 *
 * Mirrors supabase/functions/_shared/constants.ts on the server.
 */

export const CONSTANT_REF_RE = /\{@([A-Z][A-Z0-9_]{0,63})\}/g;

export type Constants = Record<string, string>;

/** Names referenced by a text, deduplicated, in order of first appearance. */
export function referencedConstants(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CONSTANT_REF_RE)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface ExpandResult {
  text: string;
  used: string[];
  missing: string[];
}

/** Replace every `{@NAME}` with its value. Unknown names stay as markers. */
export function expandConstants(text: string, constants: Constants | null | undefined): ExpandResult {
  const used: string[] = [];
  const missing: string[] = [];
  if (!text || !text.includes("{@")) return { text, used, missing };
  const out = text.replace(CONSTANT_REF_RE, (marker, name: string) => {
    const value = constants?.[name];
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return marker;
    }
    if (!used.includes(name)) used.push(name);
    return value;
  });
  return { text: out, used, missing };
}

/**
 * Inverse of expansion for ONE (key, lang): turn literal values back into
 * markers, but only for `names` (the constants this value referenced on the
 * server) and only with the values in `constants` (the snapshot that was
 * expanded). Longest value first so a value that is a prefix of another
 * never steals its match. Text the user typed as `{@NAME}` is left alone.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contractConstants(
  text: string,
  names: Iterable<string>,
  constants: Constants | null | undefined,
): string {
  if (!text || !constants) return text;
  const ordered = [...new Set(names)]
    .filter(n => typeof constants[n] === "string" && constants[n].length > 0)
    .sort((a, b) => constants[b].length - constants[a].length);
  if (ordered.length === 0) return text;

  // Single pass: existing markers are matched first and preserved, so a
  // value that happens to appear inside a marker we just produced (USD
  // inside {@USDT}) can never be re-contracted. Values are tried longest
  // first at each position.
  const byValue = new Map<string, string>();
  for (const name of ordered) byValue.set(constants[name], name);
  const alternation = ordered.map(n => escapeRegExp(constants[n])).join("|");
  const re = new RegExp(`(\\{@[A-Z][A-Z0-9_]{0,63}\\})|(${alternation})`, "g");
  return text.replace(re, (match, marker: string | undefined, value: string | undefined) => {
    if (marker) return marker;
    const name = value !== undefined ? byValue.get(value) : undefined;
    return name ? `{@${name}}` : match;
  });
}

export interface ExpandedWordings<W extends { value_json: Record<string, string> }> {
  wordings: W[];
  /** Per "ns:key" → lang → constants expanded there. Persisted in push state. */
  used: Record<string, Record<string, string[]>>;
  /** Referenced names with no definition (deduplicated). */
  missing: string[];
}

/** Expand every value of every wording into NEW objects (inputs untouched). */
export function expandWordings<W extends { namespace: string; key: string; value_json: Record<string, string> }>(
  wordings: W[],
  constants: Constants | null | undefined,
): ExpandedWordings<W> {
  const used: Record<string, Record<string, string[]>> = {};
  const missing = new Set<string>();
  const out = wordings.map(w => {
    const value_json: Record<string, string> = {};
    for (const [lang, val] of Object.entries(w.value_json)) {
      if (typeof val !== "string") continue;
      const r = expandConstants(val, constants);
      value_json[lang] = r.text;
      if (r.used.length > 0) {
        const k = `${w.namespace}:${w.key}`;
        (used[k] ??= {})[lang] = r.used;
      }
      for (const m of r.missing) missing.add(m);
    }
    return { ...w, value_json };
  });
  return { wordings: out, used, missing: [...missing] };
}

/**
 * Contract local (expanded) wordings back to markers before the three-way
 * diff. For each (key, lang) the candidate names are the union of what the
 * push-state baseline value references (markers are stored unexpanded there)
 * and what the server value references now. Values come from the snapshot
 * that was expanded into the files first, then the current map.
 */
export function contractWordings<W extends { namespace: string; key: string; value_json: Record<string, string> }>(
  localWordings: W[],
  serverWordings: Array<{ namespace: string; key: string; value_json: Record<string, string> }>,
  baselineValues: Record<string, Record<string, string>> | undefined,
  snapshot: Constants | null | undefined,
  current: Constants | null | undefined,
): W[] {
  if (!snapshot && !current) return localWordings;
  const serverIdx = new Map<string, Record<string, string>>();
  for (const s of serverWordings) serverIdx.set(`${s.namespace}:${s.key}`, s.value_json);
  const values: Constants = { ...(current ?? {}), ...(snapshot ?? {}) };

  return localWordings.map(w => {
    const k = `${w.namespace}:${w.key}`;
    const sv = serverIdx.get(k);
    const pv = baselineValues?.[k];
    const value_json: Record<string, string> = {};
    let changed = false;
    for (const [lang, val] of Object.entries(w.value_json)) {
      if (typeof val !== "string") continue;
      const names = new Set<string>([
        ...(pv?.[lang] ? referencedConstants(pv[lang]) : []),
        ...(sv?.[lang] ? referencedConstants(sv[lang]) : []),
      ]);
      const next = names.size > 0 ? contractConstants(val, names, values) : val;
      if (next !== val) changed = true;
      value_json[lang] = next;
    }
    return changed ? { ...w, value_json } : w;
  });
}

/**
 * (key, lang) pairs whose server value references a constant whose value
 * differs between the snapshot expanded into the files and the current map
 * (added, removed or edited constant). Their files are stale even though no
 * wording changed, so the push flow rewrites them as server-only changes.
 */
export function staleConstantRefs(
  serverWordings: Array<{ namespace: string; key: string; value_json: Record<string, string> }>,
  snapshot: Constants | null | undefined,
  current: Constants | null | undefined,
): Array<{ namespace: string; key: string; lang: string; value: string }> {
  const changed = new Set<string>();
  for (const name of new Set([...Object.keys(snapshot ?? {}), ...Object.keys(current ?? {})])) {
    if ((snapshot ?? {})[name] !== (current ?? {})[name]) changed.add(name);
  }
  if (changed.size === 0) return [];
  const out: Array<{ namespace: string; key: string; lang: string; value: string }> = [];
  for (const w of serverWordings) {
    for (const [lang, val] of Object.entries(w.value_json)) {
      if (typeof val !== "string" || !val.includes("{@")) continue;
      if (referencedConstants(val).some(n => changed.has(n))) {
        out.push({ namespace: w.namespace, key: w.key, lang, value: val });
      }
    }
  }
  return out;
}
