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

export type ContractValues = Record<string, string | string[]>;

export function contractConstants(
  text: string,
  names: Iterable<string>,
  constants: ContractValues | null | undefined,
): string {
  if (!text || !constants) return text;
  // Every candidate literal → its name. A name may carry several values (the
  // snapshot expanded into the file, then the current server value) so a
  // user who retypes the NEW literal after a server-side change still
  // round-trips. First name wins on a value collision (values are also
  // required to be unique by the server/editor).
  const byValue = new Map<string, string>();
  for (const name of new Set(names)) {
    const raw = constants[name];
    const vals = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const v of vals) {
      if (typeof v === "string" && v.length > 0 && !byValue.has(v)) byValue.set(v, name);
    }
  }
  if (byValue.size === 0) return text;

  // Single pass over marker-free segments: existing markers are split out
  // first and preserved verbatim, so a value can never eat the opening brace
  // of a marker nor be re-contracted inside one we just produced. Values are
  // tried longest first at each position.
  const ordered = [...byValue.keys()].sort((x, y) => y.length - x.length);
  const valueRe = new RegExp(ordered.map(escapeRegExp).join("|"), "g");
  const markerSplit = new RegExp(`(${CONSTANT_REF_RE.source})`, "g");
  return text
    .split(markerSplit)
    .map((segment, i) =>
      i % 3 === 1
        ? segment // marker (odd index of the capture split)
        : i % 3 === 2
          ? "" // inner capture group of the marker (name) — already part of segment 1
          : segment.replace(valueRe, v => `{@${byValue.get(v)!}}`),
    )
    .join("");
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
  // Per name: snapshot value first (what the files contain), then the current
  // server value (what a user may have retyped after a server-side change).
  const values: ContractValues = {};
  for (const name of new Set([...Object.keys(snapshot ?? {}), ...Object.keys(current ?? {})])) {
    const list = [snapshot?.[name], current?.[name]].filter(
      (v, i, arr): v is string => typeof v === "string" && v.length > 0 && arr.indexOf(v) === i,
    );
    if (list.length > 0) values[name] = list;
  }

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

/**
 * Prepare server-side values (markers) for writing to local files: expand
 * with the current map and report undefined constants so callers can warn
 * instead of silently writing `{@NOPE}` literals.
 */
export function expandForWrite<C extends { value: string }>(
  changes: C[],
  constants: Constants | null | undefined,
): { changes: C[]; missing: string[] } {
  const missing = new Set<string>();
  const out = changes.map(c => {
    const r = expandConstants(c.value, constants);
    for (const m of r.missing) missing.add(m);
    return r.text === c.value ? c : { ...c, value: r.text };
  });
  return { changes: out, missing: [...missing] };
}

/**
 * After a push, every pushed (key, lang) whose contracted value references a
 * constant must be rewritten to disk expanded with the CURRENT map. Otherwise
 * a file edited while a constant changed server-side keeps the OLD expansion
 * while the state snapshot advances, and the next push would misread the
 * stale literal as an edit and overwrite the marker.
 */
export function pushedConstantRewrites(
  pushedPerKeyLang: Record<string, Record<string, string>>,
): Array<{ namespace: string; key: string; lang: string; value: string; previous: string }> {
  const out: Array<{ namespace: string; key: string; lang: string; value: string; previous: string }> = [];
  for (const [nsKey, langs] of Object.entries(pushedPerKeyLang)) {
    const colon = nsKey.indexOf(":");
    const namespace = nsKey.slice(0, colon);
    const key = nsKey.slice(colon + 1);
    for (const [lang, value] of Object.entries(langs)) {
      if (typeof value === "string" && value.includes("{@")) {
        out.push({ namespace, key, lang, value, previous: value });
      }
    }
  }
  return out;
}
