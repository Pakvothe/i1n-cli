import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractVariables, replaceVariables } from "../src/shared/variables.js";
import { flattenObject, unflattenObject } from "../src/parsers/utils.js";
import { generateTypeDefinitions } from "../src/shared/codegen.js";
import { readProjectConfig, writeProjectConfig, projectConfigExists, ensureGitignore } from "../src/shared/config.js";
import { readPushState, writePushState, getChangedWordings } from "../src/shared/push-state.js";
import { normalizeLocaleCode, normalizeWordingLanguages } from "../src/shared/languages.js";
import type { Wording, I1nProjectConfig } from "../src/shared/types.js";

describe("extractVariables", () => {
  it("extracts {var} syntax", () => {
    expect(extractVariables("Hello {name}")).toEqual(["name"]);
  });

  it("extracts {{var}} syntax", () => {
    expect(extractVariables("Hello {{name}}")).toEqual(["name"]);
  });

  it("extracts %{var} syntax", () => {
    expect(extractVariables("Hello %{name}")).toEqual(["name"]);
  });

  it("extracts multiple variables", () => {
    const vars = extractVariables("{greeting}, {name}! You have {count} items.");
    expect(vars).toEqual(["greeting", "name", "count"]);
  });

  it("deduplicates variables", () => {
    expect(extractVariables("{name} and {name}")).toEqual(["name"]);
  });

  it("returns empty for no variables", () => {
    expect(extractVariables("plain text")).toEqual([]);
  });

  it("handles mixed syntaxes", () => {
    const vars = extractVariables("{{greeting}} %{name} {count}");
    expect(vars).toEqual(["greeting", "name", "count"]);
  });

  it("does not match empty braces", () => {
    expect(extractVariables("{}")).toEqual([]);
  });
});

describe("replaceVariables", () => {
  it("replaces {var}", () => {
    expect(replaceVariables("Hello {name}", { name: "World" })).toBe("Hello World");
  });

  it("replaces {{var}}", () => {
    expect(replaceVariables("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("replaces %{var}", () => {
    expect(replaceVariables("Hello %{name}", { name: "World" })).toBe("Hello World");
  });

  it("leaves unknown variables unchanged", () => {
    expect(replaceVariables("Hello {name}", {})).toBe("Hello {name}");
  });

  it("replaces multiple variables", () => {
    const result = replaceVariables("{a} and {b}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y");
  });
});

describe("flattenObject", () => {
  it("flattens nested objects", () => {
    const result = flattenObject({ a: { b: { c: "deep" } } });
    expect(result).toEqual({ "a.b.c": "deep" });
  });

  it("handles flat objects", () => {
    const result = flattenObject({ key: "value" });
    expect(result).toEqual({ key: "value" });
  });

  it("converts numbers to strings", () => {
    const result = flattenObject({ count: 5 });
    expect(result).toEqual({ count: "5" });
  });

  it("converts booleans to strings", () => {
    const result = flattenObject({ active: true, disabled: false });
    expect(result).toEqual({ active: "true", disabled: "false" });
  });

  it("skips arrays", () => {
    const result = flattenObject({ list: [1, 2, 3] as unknown as Record<string, unknown> });
    expect(result).toEqual({});
  });

  it("skips null", () => {
    const result = flattenObject({ nothing: null as unknown as string });
    expect(result).toEqual({});
  });

  it("handles multiple levels", () => {
    const result = flattenObject({
      level1: {
        level2a: "a",
        level2b: { level3: "b" },
      },
    });
    expect(result).toEqual({
      "level1.level2a": "a",
      "level1.level2b.level3": "b",
    });
  });
});

describe("unflattenObject", () => {
  it("unflattens dot-notation keys", () => {
    const result = unflattenObject({ "a.b.c": "deep" });
    expect(result).toEqual({ a: { b: { c: "deep" } } });
  });

  it("handles flat keys", () => {
    const result = unflattenObject({ key: "value" });
    expect(result).toEqual({ key: "value" });
  });

  it("merges sibling keys", () => {
    const result = unflattenObject({
      "a.x": "1",
      "a.y": "2",
    });
    expect(result).toEqual({ a: { x: "1", y: "2" } });
  });

  it("handles key collision (string vs nested)", () => {
    const result = unflattenObject({
      "a": "string value",
      "a.b": "nested value",
    });
    expect(result.a).toBe("string value");
  });

  it("roundtrips with flattenObject", () => {
    const original = {
      simple: "value",
      nested: { deep: { key: "here" } },
      multi: { a: "1", b: "2" },
    };

    const flat = flattenObject(original);
    const restored = unflattenObject(flat);
    expect(restored).toEqual(original);
  });
});

describe("generateTypeDefinitions", () => {
  it("generates type definitions for keys without variables", () => {
    const wordings: Wording[] = [
      { key: "title", namespace: "common", value_json: { en: "Hello" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain("\"common.title\": Record<string, never>");
  });

  it("generates typed variables for keys with variables", () => {
    const wordings: Wording[] = [
      { key: "greeting", namespace: "ui", value_json: { en: "Hello {name}, you have {count} items" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain("\"ui.greeting\": { name: string; count: string }");
  });

  it("generates valid module declaration", () => {
    const wordings: Wording[] = [
      { key: "test", namespace: "ns", value_json: { en: "Test" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain('declare module "i1n"');
    expect(output).toContain("interface I1nKeys");
    expect(output).toContain("type I1nKey = keyof I1nKeys");
    expect(output).toContain("function t<K extends I1nKey>");
  });

  it("sorts keys alphabetically by full key", () => {
    const wordings: Wording[] = [
      { key: "z", namespace: "b", value_json: { en: "Z" } },
      { key: "a", namespace: "a", value_json: { en: "A" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    const aIndex = output.indexOf('"a.a"');
    const bIndex = output.indexOf('"b.z"');
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("uses empty Record for keys without source locale value", () => {
    const wordings: Wording[] = [
      { key: "missing", namespace: "ns", value_json: { es: "Texto" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain("Record<string, never>");
  });
});

describe("project config", () => {
  let dir: string;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-config-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const validConfig: I1nProjectConfig = {
    apiKey: "i1n_0123456789abcdef0123456789abcdef",
    projectId: "550e8400-e29b-41d4-a716-446655440000",
    localesDir: "locales",
    sourceLocale: "en",
    format: "nested-json",
    framework: "i18next",
  };

  it("writes and reads config", () => {
    writeProjectConfig(validConfig, dir);
    const read = readProjectConfig(dir);
    expect(read).toEqual(validConfig);
  });

  it("returns null for non-existent config", () => {
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("returns null for invalid config", () => {
    fs.writeFileSync(path.join(dir, "i1n.config.json"), '{"invalid": true}', "utf-8");
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects path traversal in localesDir", () => {
    const malicious = { ...validConfig, localesDir: "../../../etc" };
    fs.writeFileSync(path.join(dir, "i1n.config.json"), JSON.stringify(malicious), "utf-8");
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects absolute path in localesDir", () => {
    const malicious = { ...validConfig, localesDir: "/etc/locales" };
    fs.writeFileSync(path.join(dir, "i1n.config.json"), JSON.stringify(malicious), "utf-8");
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects invalid locale code", () => {
    const bad = { ...validConfig, sourceLocale: "not-a-locale-123" };
    fs.writeFileSync(path.join(dir, "i1n.config.json"), JSON.stringify(bad), "utf-8");
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("accepts valid locale codes", () => {
    for (const locale of ["en", "es", "pt_br", "en-US", "zh_Hans"]) {
      const cfg = { ...validConfig, sourceLocale: locale };
      writeProjectConfig(cfg, dir);
      expect(readProjectConfig(dir)).not.toBeNull();
    }
  });

  it("reports config existence correctly", () => {
    expect(projectConfigExists(dir)).toBe(false);
    writeProjectConfig(validConfig, dir);
    expect(projectConfigExists(dir)).toBe(true);
  });
});

describe("ensureGitignore", () => {
  let dir: string;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-git-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates .gitignore with both entries if none exists", () => {
    ensureGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("i1n.config.json");
    expect(content).toContain("**/.i1n-push-state.json");
  });

  it("appends missing entries to existing .gitignore", () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    ensureGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("i1n.config.json");
    expect(content).toContain("**/.i1n-push-state.json");
  });

  it("does not duplicate entries if already present", () => {
    ensureGitignore(dir);
    ensureGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    const configMatches = content.match(/i1n\.config\.json/g);
    expect(configMatches?.length).toBe(1);
  });

  it("appends only the missing entry if one is already present", () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "i1n.config.json\n");
    ensureGitignore(dir);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("**/.i1n-push-state.json");
    const configMatches = content.match(/i1n\.config\.json/g);
    expect(configMatches?.length).toBe(1);
  });
});

describe("push state", () => {
  let dir: string;

  const wordings: Wording[] = [
    { key: "title", namespace: "common", value_json: { en_us: "Hello" } },
    { key: "greeting", namespace: "common", value_json: { en_us: "Hi {name}" } },
    { key: "save", namespace: "buttons", value_json: { en_us: "Save" } },
  ];

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-push-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns empty state when no file exists", () => {
    const state = readPushState(dir);
    expect(state).toEqual({});
  });

  it("writes and reads state", () => {
    writePushState(wordings, dir);
    const state = readPushState(dir);
    expect(Object.keys(state).length).toBe(3);
    expect(state["common:title"]).toBeDefined();
    expect(state["common:greeting"]).toBeDefined();
    expect(state["buttons:save"]).toBeDefined();
  });

  it("returns all wordings as changed on first push (no state file)", () => {
    const { changed, unchanged } = getChangedWordings(wordings, dir);
    expect(changed.length).toBe(3);
    expect(unchanged).toBe(0);
  });

  it("returns no changes when nothing changed", () => {
    writePushState(wordings, dir);
    const { changed, unchanged } = getChangedWordings(wordings, dir);
    expect(changed.length).toBe(0);
    expect(unchanged).toBe(3);
  });

  it("detects changed wordings", () => {
    writePushState(wordings, dir);

    const modified = [
      { key: "title", namespace: "common", value_json: { en_us: "Hello World" } },
      { key: "greeting", namespace: "common", value_json: { en_us: "Hi {name}" } },
      { key: "save", namespace: "buttons", value_json: { en_us: "Save" } },
    ];

    const { changed, unchanged } = getChangedWordings(modified, dir);
    expect(changed.length).toBe(1);
    expect(changed[0].key).toBe("title");
    expect(unchanged).toBe(2);
  });

  it("detects new wordings as changed", () => {
    writePushState(wordings, dir);

    const withNew = [
      ...wordings,
      { key: "cancel", namespace: "buttons", value_json: { en_us: "Cancel" } },
    ];

    const { changed, unchanged } = getChangedWordings(withNew, dir);
    expect(changed.length).toBe(1);
    expect(changed[0].key).toBe("cancel");
    expect(unchanged).toBe(3);
  });

  it("handles corrupt state file gracefully", () => {
    fs.writeFileSync(path.join(dir, ".i1n-push-state.json"), "not json", "utf-8");
    const state = readPushState(dir);
    expect(state).toEqual({});
  });
});

const SUPPORTED_CODES = ["en_us", "es_es", "fr_fr", "pt_br", "de_de", "ja_jp", "zh_cn"];

describe("normalizeLocaleCode", () => {
  it("returns exact match", () => {
    expect(normalizeLocaleCode("en_us", SUPPORTED_CODES)).toBe("en_us");
  });

  it("converts hyphens to underscores", () => {
    expect(normalizeLocaleCode("en-us", SUPPORTED_CODES)).toBe("en_us");
  });

  it("lowercases the code", () => {
    expect(normalizeLocaleCode("en_US", SUPPORTED_CODES)).toBe("en_us");
  });

  it("handles mixed case with hyphens", () => {
    expect(normalizeLocaleCode("pt-BR", SUPPORTED_CODES)).toBe("pt_br");
  });

  it("expands short code to first match", () => {
    expect(normalizeLocaleCode("en", SUPPORTED_CODES)).toBe("en_us");
  });

  it("expands short code es to es_es", () => {
    expect(normalizeLocaleCode("es", SUPPORTED_CODES)).toBe("es_es");
  });

  it("returns null for unsupported code", () => {
    expect(normalizeLocaleCode("xx", SUPPORTED_CODES)).toBeNull();
  });

  it("returns null for unsupported full code", () => {
    expect(normalizeLocaleCode("ko_kr", SUPPORTED_CODES)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeLocaleCode("", SUPPORTED_CODES)).toBeNull();
  });
});

describe("normalizeWordingLanguages", () => {
  it("passes through already-normalized codes", () => {
    const input = { en_us: "Hello", es_es: "Hola" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(input, SUPPORTED_CODES);
    expect(normalized).toEqual({ en_us: "Hello", es_es: "Hola" });
    expect(mappings.size).toBe(0);
    expect(unsupported).toEqual([]);
  });

  it("normalizes hyphenated codes and tracks mappings", () => {
    const input = { "en-US": "Hello", "pt-BR": "Olá" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(input, SUPPORTED_CODES);
    expect(normalized).toEqual({ en_us: "Hello", pt_br: "Olá" });
    expect(mappings.get("en-US")).toBe("en_us");
    expect(mappings.get("pt-BR")).toBe("pt_br");
    expect(unsupported).toEqual([]);
  });

  it("expands short codes and tracks mappings", () => {
    const input = { en: "Hello", fr: "Bonjour" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(input, SUPPORTED_CODES);
    expect(normalized).toEqual({ en_us: "Hello", fr_fr: "Bonjour" });
    expect(mappings.get("en")).toBe("en_us");
    expect(mappings.get("fr")).toBe("fr_fr");
  });

  it("collects unsupported codes", () => {
    const input = { en_us: "Hello", xx: "Unknown", yy_zz: "Also unknown" };
    const { normalized, unsupported } = normalizeWordingLanguages(input, SUPPORTED_CODES);
    expect(normalized).toEqual({ en_us: "Hello" });
    expect(unsupported).toEqual(["xx", "yy_zz"]);
  });

  it("handles mixed valid and invalid codes", () => {
    const input = { en: "Hello", "pt-BR": "Olá", xx: "Bad" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(input, SUPPORTED_CODES);
    expect(normalized).toEqual({ en_us: "Hello", pt_br: "Olá" });
    expect(mappings.size).toBe(2);
    expect(unsupported).toEqual(["xx"]);
  });

  it("handles empty input", () => {
    const { normalized, mappings, unsupported } = normalizeWordingLanguages({}, SUPPORTED_CODES);
    expect(normalized).toEqual({});
    expect(mappings.size).toBe(0);
    expect(unsupported).toEqual([]);
  });
});
