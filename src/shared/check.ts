import type { I1nProjectConfig, ParseWarning, Wording } from "./types.js";
import { extractVariables } from "./variables.js";

export type CheckIssueType =
  | "missing_key"
  | "empty_value"
  | "placeholder_mismatch"
  | "parse_warning";

export interface CheckIssue {
  type: CheckIssueType;
  severity: "error" | "warning";
  namespace: string;
  key: string;
  lang?: string;
  detail: string;
}

export interface CheckReport {
  issues: CheckIssue[];
  coverage: {
    overall: number;
    byLanguage: Record<string, number>;
  };
  counts: {
    keys: number;
    languages: number;
    errors: number;
    warnings: number;
  };
  languages: string[];
}

export interface CheckOptions {
  /** Fail (treat as error) when overall coverage % is below this value. */
  minCoverage?: number;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate parsed wordings offline: key coverage across languages,
 * interpolation placeholder consistency against the source locale, and
 * parser warnings. Pure — no filesystem or network access.
 */
export function runCheck(
  config: Pick<I1nProjectConfig, "sourceLocale">,
  wordings: Wording[],
  parseWarnings: ParseWarning[] = [],
  options: CheckOptions = {},
): CheckReport {
  const issues: CheckIssue[] = [];
  const source = config.sourceLocale;

  // Language universe = every locale seen in any wording (config has no target list)
  const langSet = new Set<string>();
  for (const w of wordings) {
    for (const lang of Object.keys(w.value_json)) langSet.add(lang);
  }
  langSet.add(source);
  const languages = [...langSet].sort();
  const targets = languages.filter(l => l !== source);

  for (const warning of parseWarnings) {
    issues.push({
      type: "parse_warning",
      severity: "error",
      namespace: "",
      key: warning.file,
      detail: warning.message,
    });
  }

  let translatedCells = 0;
  const translatedByLang: Record<string, number> = {};
  for (const lang of targets) translatedByLang[lang] = 0;

  for (const w of wordings) {
    const sourceValue = w.value_json[source];

    if (!hasValue(sourceValue)) {
      issues.push({
        type: "missing_key",
        severity: "warning",
        namespace: w.namespace,
        key: w.key,
        lang: source,
        detail: `No ${source} (source) value`,
      });
    }

    const sourceVars = hasValue(sourceValue) ? extractVariables(sourceValue!) : [];

    for (const lang of targets) {
      const value = w.value_json[lang];

      if (value === undefined) {
        issues.push({
          type: "missing_key",
          severity: "warning",
          namespace: w.namespace,
          key: w.key,
          lang,
          detail: `Missing in ${lang}`,
        });
        continue;
      }

      if (!hasValue(value)) {
        issues.push({
          type: "empty_value",
          severity: "warning",
          namespace: w.namespace,
          key: w.key,
          lang,
          detail: `Empty value in ${lang}`,
        });
        continue;
      }

      translatedCells++;
      translatedByLang[lang]++;

      // Masking-style tokens (__VAR_1__, __wu__) leaking from a translation
      // pipeline are always wrong, even when the source has no variables.
      const leaked = value.match(/__[A-Za-z]+_?\d*__/g);
      if (leaked) {
        issues.push({
          type: "placeholder_mismatch",
          severity: "error",
          namespace: w.namespace,
          key: w.key,
          lang,
          detail: `Leaked masking token(s): ${[...new Set(leaked)].join(", ")}`,
        });
      }

      if (hasValue(sourceValue)) {
        const langVars = extractVariables(value);
        const missing = sourceVars.filter(v => !langVars.includes(v));
        const added = langVars.filter(v => !sourceVars.includes(v));
        if (missing.length > 0 || added.length > 0) {
          const parts: string[] = [];
          if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
          if (added.length > 0) parts.push(`unexpected: ${added.join(", ")}`);
          issues.push({
            type: "placeholder_mismatch",
            severity: "error",
            namespace: w.namespace,
            key: w.key,
            lang,
            detail: `Placeholders differ from ${source} (${parts.join("; ")})`,
          });
        }
      }
    }
  }

  const totalCells = wordings.length * targets.length;
  const overall = totalCells === 0 ? 100 : (translatedCells / totalCells) * 100;
  const byLanguage: Record<string, number> = {};
  for (const lang of targets) {
    byLanguage[lang] =
      wordings.length === 0 ? 100 : (translatedByLang[lang] / wordings.length) * 100;
  }

  if (options.minCoverage !== undefined && overall < options.minCoverage) {
    issues.push({
      type: "missing_key",
      severity: "error",
      namespace: "",
      key: "",
      detail: `Coverage ${overall.toFixed(1)}% is below required minimum ${options.minCoverage}%`,
    });
  }

  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;

  return {
    issues,
    coverage: { overall, byLanguage },
    counts: { keys: wordings.length, languages: languages.length, errors, warnings },
    languages,
  };
}
