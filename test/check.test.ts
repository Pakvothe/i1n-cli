import { describe, expect, test } from "bun:test";

import { runCheck } from "../src/shared/check";
import type { Wording } from "../src/shared/types";

const CONFIG = { sourceLocale: "en_us" };

function w(key: string, values: Record<string, string>, namespace = "common"): Wording {
  return { key, namespace, value_json: values };
}

describe("runCheck", () => {
  test("clean project reports no issues and 100% coverage", () => {
    const report = runCheck(CONFIG, [
      w("greeting", { en_us: "Hello {name}", es_ar: "Hola {name}" }),
      w("bye", { en_us: "Bye", es_ar: "Chau" }),
    ]);
    expect(report.issues).toHaveLength(0);
    expect(report.coverage.overall).toBe(100);
    expect(report.coverage.byLanguage.es_ar).toBe(100);
    expect(report.counts.errors).toBe(0);
    expect(report.counts.keys).toBe(2);
  });

  test("missing translation is a warning and lowers coverage", () => {
    const report = runCheck(CONFIG, [
      w("a", { en_us: "A", es_ar: "A-es" }),
      w("b", { en_us: "B" }),
    ]);
    const missing = report.issues.filter(i => i.type === "missing_key");
    expect(missing).toHaveLength(1);
    expect(missing[0].lang).toBe("es_ar");
    expect(missing[0].key).toBe("b");
    expect(missing[0].severity).toBe("warning");
    expect(report.coverage.overall).toBe(50);
    expect(report.counts.errors).toBe(0);
  });

  test("placeholder mismatch is an error — missing and unexpected variables", () => {
    const report = runCheck(CONFIG, [
      w("greeting", { en_us: "Hello {{name}}", es_ar: "Hola {{nombre}}" }),
    ]);
    const mismatches = report.issues.filter(i => i.type === "placeholder_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("error");
    expect(mismatches[0].detail).toContain("missing: name");
    expect(mismatches[0].detail).toContain("unexpected: nombre");
    expect(report.counts.errors).toBe(1);
  });

  test("placeholder dropped entirely in translation is detected", () => {
    const report = runCheck(CONFIG, [
      w("count", { en_us: "{count} items", es_ar: "elementos" }),
    ]);
    const mismatches = report.issues.filter(i => i.type === "placeholder_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].detail).toContain("missing: count");
  });

  test("ruby-style %{var} placeholders are compared too", () => {
    const report = runCheck(CONFIG, [
      w("hi", { en_us: "Hi %{user}", pt_br: "Oi %{user}" }),
      w("yo", { en_us: "Yo %{user}", pt_br: "Oi" }),
    ]);
    expect(report.issues.filter(i => i.type === "placeholder_mismatch")).toHaveLength(1);
  });

  test("empty value is a warning, not counted as translated", () => {
    const report = runCheck(CONFIG, [
      w("a", { en_us: "A", es_ar: "   " }),
    ]);
    expect(report.issues.filter(i => i.type === "empty_value")).toHaveLength(1);
    expect(report.coverage.overall).toBe(0);
  });

  test("missing source value is flagged", () => {
    const report = runCheck(CONFIG, [
      w("orphan", { es_ar: "Solo en español" }),
    ]);
    const sourceMissing = report.issues.filter(
      i => i.type === "missing_key" && i.lang === "en_us",
    );
    expect(sourceMissing).toHaveLength(1);
  });

  test("parse warnings become error-level issues", () => {
    const report = runCheck(
      CONFIG,
      [w("a", { en_us: "A" })],
      [{ file: "locales/es_ar/common.json", message: "Invalid JSON" }],
    );
    const parseIssues = report.issues.filter(i => i.type === "parse_warning");
    expect(parseIssues).toHaveLength(1);
    expect(parseIssues[0].severity).toBe("error");
    expect(report.counts.errors).toBe(1);
  });

  test("minCoverage below threshold adds an error", () => {
    const report = runCheck(
      CONFIG,
      [w("a", { en_us: "A", es_ar: "A" }), w("b", { en_us: "B" })],
      [],
      { minCoverage: 90 },
    );
    expect(report.counts.errors).toBe(1);
    expect(report.issues.some(i => i.detail.includes("below required minimum"))).toBe(true);
  });

  test("minCoverage met adds no error", () => {
    const report = runCheck(
      CONFIG,
      [w("a", { en_us: "A", es_ar: "A" })],
      [],
      { minCoverage: 100 },
    );
    expect(report.counts.errors).toBe(0);
  });

  test("source-only project (no targets) reports 100% coverage", () => {
    const report = runCheck(CONFIG, [w("a", { en_us: "A" })]);
    expect(report.coverage.overall).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  test("per-language coverage is independent", () => {
    const report = runCheck(CONFIG, [
      w("a", { en_us: "A", es_ar: "A", pt_br: "A" }),
      w("b", { en_us: "B", es_ar: "B" }),
    ]);
    expect(report.coverage.byLanguage.es_ar).toBe(100);
    expect(report.coverage.byLanguage.pt_br).toBe(50);
    expect(report.coverage.overall).toBe(75);
  });
});

describe("leaked masking tokens", () => {
  test("flags __VAR_N__ even when source has no variables", () => {
    const report = runCheck({ sourceLocale: "en_us" }, [
      { key: "t", namespace: "n", value_json: { en_us: "Plurals preserved", it_it: "Plurali (__VAR_1__, __VAR_2__) conservati" } },
    ]);
    const leaks = report.issues.filter(i => i.detail.includes("Leaked masking token"));
    expect(leaks).toHaveLength(1);
    expect(leaks[0].severity).toBe("error");
    expect(leaks[0].detail).toContain("__VAR_1__");
  });

  test("flags name-style tokens like __wu__", () => {
    const report = runCheck({ sourceLocale: "en_us" }, [
      { key: "t", namespace: "n", value_json: { en_us: "Regenerate", ja_jp: "再生成 (__wu__)" } },
    ]);
    expect(report.issues.some(i => i.detail.includes("__wu__"))).toBe(true);
  });
});
