// Use [^}] instead of .+? to prevent ReDoS on malicious inputs
const VARIABLE_REGEX = /\{\{([^}]+)\}\}|%\{([^}]+)\}|\{([^}]+)\}/g;

export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  const regex = new RegExp(VARIABLE_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1] ?? match[2] ?? match[3];
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
    return key in variables ? String(variables[key]) : original;
  });
}
