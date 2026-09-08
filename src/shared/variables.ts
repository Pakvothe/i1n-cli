// Use [^}] instead of .+? to prevent ReDoS on malicious inputs
const VARIABLE_REGEX = /\{\{([^}]+)\}\}|%\{([^}]+)\}|\{([^}]+)\}/g;

/**
 * Runtime interpolation variables. Project constants (`{@NAME}`) share the
 * brace syntax but are resolved by `i1n pull`, not by the app: they are
 * excluded here so codegen doesn't demand them as call-site params and
 * `i1n check` doesn't require them in every language.
 */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  const regex = new RegExp(VARIABLE_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name && name.startsWith("@")) continue;
    if (name && !seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }

  return vars;
}

export function replaceVariables(
  text: string,
  variables: Record<string, string | number>,
): string {
  return text.replace(VARIABLE_REGEX, (original, g1, g2, g3) => {
    const key = g1 ?? g2 ?? g3;
    return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : original;
  });
}
