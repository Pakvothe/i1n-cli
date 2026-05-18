import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractVariables, replaceVariables } from "../src/shared/variables.js";
import { flattenObject, unflattenObject } from "../src/parsers/utils.js";
import { generateTypeDefinitions } from "../src/shared/codegen.js";
import {
  readProjectConfig,
  writeProjectConfig,
  projectConfigExists,
  ensureGitignore,
} from "../src/shared/config.js";
import {
  readPushState,
  writePushState,
  getChangedWordings,
  diffThreeWay,
  buildNextState,
  type PushStateV2,
} from "../src/shared/push-state.js";
import {
  normalizeLocaleCode,
  normalizeWordingLanguages,
} from "../src/shared/languages.js";
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
    const vars = extractVariables(
      "{greeting}, {name}! You have {count} items.",
    );
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
    expect(replaceVariables("Hello {name}", { name: "World" })).toBe(
      "Hello World",
    );
  });

  it("replaces {{var}}", () => {
    expect(replaceVariables("Hello {{name}}", { name: "World" })).toBe(
      "Hello World",
    );
  });

  it("replaces %{var}", () => {
    expect(replaceVariables("Hello %{name}", { name: "World" })).toBe(
      "Hello World",
    );
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
    const result = flattenObject({
      list: [1, 2, 3] as unknown as Record<string, unknown>,
    });
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
      a: "string value",
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
    expect(output).toContain('    "common.title": Record<string, never>;');
  });

  it("generates typed variables for keys with variables", () => {
    const wordings: Wording[] = [
      {
        key: "greeting",
        namespace: "ui",
        value_json: { en: "Hello {name}, you have {count} items" },
      },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain(
      '    "ui.greeting": { name: string; count: string };',
    );
  });

  it("generates valid module declaration", () => {
    const wordings: Wording[] = [
      { key: "test", namespace: "ns", value_json: { en: "Test" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain('import "i1n";');
    expect(output).toContain('declare module "i1n"');
    expect(output).toContain("interface I1nKeys");
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
    expect(output).toContain("Record<string, never>;");
  });

  it("strips redundant namespace from dirty keys", () => {
    const wordings: Wording[] = [
      { key: "auth.login", namespace: "auth", value_json: { en: "Login" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    // Should NOT contain "auth.auth.login"
    expect(output).toContain('    "auth.login": Record<string, never>;');
    expect(output).not.toContain('"auth.auth.login"');
  });

  it("dedupes two wordings that canonicalize to the same fullKey", () => {
    // Repro of the dashboard-bulk-import vs CLI-push collision:
    //   row A: (common, "common.hello")  ← stored by bulk import (pre-fix)
    //   row B: (common, "hello")         ← stored by `i1n push`
    // Both resolve to fullKey "common.hello" in the type generator.
    const wordings: Wording[] = [
      { key: "common.hello", namespace: "common", value_json: { en: "Hi" } },
      { key: "hello", namespace: "common", value_json: { en: "Hi" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    const occurrences = output.split('"common.hello"').length - 1;
    expect(occurrences).toBe(1);
  });

  it("lets the plural variant win when a regular literal shares its base", () => {
    // If a project has both a regular `common.hello` and a plural family
    // `common.hello_one`/`common.hello_other`, the plural family carries
    // strictly more type information (`count: number`). The literal must
    // not pre-empt the base with a `Record<string, never>` type, which
    // would silently drop the plural typing and break consumers calling
    // `t('common.hello', { count: 1 })`.
    const wordings: Wording[] = [
      { key: "hello", namespace: "common", value_json: { en: "Hello" } },
      { key: "hello_one", namespace: "common", value_json: { en: "{count} item" } },
      { key: "hello_other", namespace: "common", value_json: { en: "{count} items" } },
    ];

    const output = generateTypeDefinitions(wordings, "en");
    expect(output).toContain('"common.hello": { count: number };');
    expect(output).not.toContain('"common.hello": Record<string, never>;');
  });
});

describe("project config", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-config-"));
  });
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
    fs.writeFileSync(
      path.join(dir, "i1n.config.json"),
      '{"invalid": true}',
      "utf-8",
    );
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects path traversal in localesDir", () => {
    const malicious = { ...validConfig, localesDir: "../../../etc" };
    fs.writeFileSync(
      path.join(dir, "i1n.config.json"),
      JSON.stringify(malicious),
      "utf-8",
    );
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects absolute path in localesDir", () => {
    const malicious = { ...validConfig, localesDir: "/etc/locales" };
    fs.writeFileSync(
      path.join(dir, "i1n.config.json"),
      JSON.stringify(malicious),
      "utf-8",
    );
    expect(readProjectConfig(dir)).toBeNull();
  });

  it("rejects invalid locale code", () => {
    const bad = { ...validConfig, sourceLocale: "not-a-locale-123" };
    fs.writeFileSync(
      path.join(dir, "i1n.config.json"),
      JSON.stringify(bad),
      "utf-8",
    );
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-git-"));
  });
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

describe("push state (v2)", () => {
  let dir: string;

  const emptyState: PushStateV2 = { version: 2, wordings: {} };

  function stateOf(
    entries: Record<string, { values: Record<string, string>; updated_at?: string }>,
  ): PushStateV2 {
    return { version: 2, wordings: entries };
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "i1n-push-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns empty v2 state when no file exists", () => {
    const state = readPushState(dir);
    expect(state).toEqual(emptyState);
  });

  it("round-trips a v2 state file", () => {
    const written: PushStateV2 = stateOf({
      "common:title": {
        values: { en_us: "Hello" },
        updated_at: "2026-05-12T10:00:00Z",
      },
    });
    writePushState(written, dir);
    const read = readPushState(dir);
    expect(read).toEqual(written);
  });

  it("discards a v1 state file (per-wording hash format)", () => {
    // Simulate v1: top-level Record<string, string> of MD5 hashes.
    fs.writeFileSync(
      path.join(dir, ".i1n-push-state.json"),
      JSON.stringify({
        "common:title": "5d41402abc4b2a76b9719d911017c592",
      }),
      "utf-8",
    );
    const state = readPushState(dir);
    expect(state).toEqual(emptyState);
  });

  it("handles corrupt state file gracefully", () => {
    fs.writeFileSync(
      path.join(dir, ".i1n-push-state.json"),
      "not json",
      "utf-8",
    );
    expect(readPushState(dir)).toEqual(emptyState);
  });

  it("getChangedWordings (deprecated) returns all wordings as changed", () => {
    const wordings: Wording[] = [
      { key: "title", namespace: "common", value_json: { en_us: "Hi" } },
    ];
    const { changed, unchanged } = getChangedWordings(wordings, dir);
    expect(changed.length).toBe(1);
    expect(unchanged).toBe(0);
  });
});

describe("diffThreeWay", () => {
  function L(values: Record<string, string>): Wording {
    return { key: "k", namespace: "ns", value_json: values };
  }
  function S(values: Record<string, string>, updated_at = "2026-05-12T10:00:00Z"): Wording {
    return { key: "k", namespace: "ns", value_json: values, updated_at };
  }
  function P(values: Record<string, string>, updated_at = "2026-05-12T10:00:00Z"): PushStateV2 {
    return {
      version: 2,
      wordings: { "ns:k": { values, updated_at } },
    };
  }
  const emptyP: PushStateV2 = { version: 2, wordings: {} };

  // (1) Pure local edit: en="new" vs en="old"=base
  it("classifies pure local edit as toPush", () => {
    const diff = diffThreeWay(
      [L({ en_us: "new" })],
      [S({ en_us: "old" })],
      P({ en_us: "old" }),
    );
    expect(diff.toPush.length).toBe(1);
    expect(diff.toPush[0].value).toBe("new");
    expect(diff.conflicts.length).toBe(0);
    expect(diff.serverOnly.length).toBe(0);
  });

  // (2) Pure server edit (THE BUG): user didn't touch, server moved → don't push
  it("classifies pure server edit as serverOnly (bug repro)", () => {
    const diff = diffThreeWay(
      [L({ en_us: "old" })],
      [S({ en_us: "new" })],
      P({ en_us: "old" }),
    );
    expect(diff.toPush.length).toBe(0);
    expect(diff.serverOnly.length).toBe(1);
    expect(diff.serverOnly[0].value).toBe("new");
  });

  // (3) Both equal
  it("classifies all-equal as unchanged", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x" })],
      P({ en_us: "x" }),
    );
    expect(diff.unchanged).toBe(1);
    expect(diff.toPush.length).toBe(0);
    expect(diff.serverOnly.length).toBe(0);
    expect(diff.conflicts.length).toBe(0);
  });

  // (4) Real conflict
  it("classifies divergent local+server as conflict", () => {
    const diff = diffThreeWay(
      [L({ en_us: "A" })],
      [S({ en_us: "B" })],
      P({ en_us: "X" }),
    );
    expect(diff.conflicts.length).toBe(1);
    expect(diff.conflicts[0].base).toBe("X");
    expect(diff.conflicts[0].local).toBe("A");
    expect(diff.conflicts[0].server).toBe("B");
  });

  // (5) Mixed langs (local en, server es) — both should bucket correctly
  it("handles per-language split: local en, server es", () => {
    const diff = diffThreeWay(
      [L({ en_us: "new", es_ar: "old" })],
      [S({ en_us: "old", es_ar: "new" })],
      P({ en_us: "old", es_ar: "old" }),
    );
    const langs = diff.toPush.map((p) => p.lang);
    expect(langs).toContain("en_us");
    expect(diff.toPush.find((p) => p.lang === "en_us")?.value).toBe("new");
    const soLangs = diff.serverOnly.map((p) => p.lang);
    expect(soLangs).toContain("es_ar");
    expect(diff.serverOnly.find((p) => p.lang === "es_ar")?.value).toBe("new");
  });

  // (6) New key (local only, server absent, P absent)
  it("classifies brand-new local key as toPush", () => {
    const diff = diffThreeWay(
      [L({ en_us: "fresh" })],
      [],
      emptyP,
    );
    expect(diff.toPush.length).toBe(1);
    expect(diff.toPush[0].value).toBe("fresh");
  });

  // (7) New lang locally — push the new lang only
  it("classifies new local lang as toPush", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x", fr_fr: "nouveau" })],
      [S({ en_us: "x" })],
      P({ en_us: "x" }),
    );
    expect(diff.toPush.length).toBe(1);
    expect(diff.toPush[0].lang).toBe("fr_fr");
  });

  // (8) New lang on server — auto-pull
  it("classifies new server lang as serverOnly", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x", fr_fr: "added" })],
      P({ en_us: "x" }),
    );
    expect(diff.serverOnly.length).toBe(1);
    expect(diff.serverOnly[0].lang).toBe("fr_fr");
  });

  // (9) Lang deleted locally — warn, no propagation
  it("classifies missing local lang (was in P+S) as localDeletion (warn)", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x", es_ar: "y" })],
      P({ en_us: "x", es_ar: "y" }),
    );
    expect(diff.localDeletions.length).toBe(1);
    expect(diff.localDeletions[0].lang).toBe("es_ar");
    expect(diff.serverOnly.length).toBe(0);
    expect(diff.toPush.length).toBe(0);
  });

  // (10) Fresh checkout, everything matches server → unchanged
  it("fresh checkout (empty P) with matching local/server is all unchanged", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x" })],
      emptyP,
    );
    expect(diff.stateWasEmpty).toBe(true);
    expect(diff.unchanged).toBe(1);
    expect(diff.toPush.length).toBe(0);
    expect(diff.conflicts.length).toBe(0);
  });

  // (11) Fresh checkout, divergence → conflict (since P:=S synthesized)
  it("fresh checkout with divergence produces a conflict", () => {
    const diff = diffThreeWay(
      [L({ en_us: "X" })],
      [S({ en_us: "Y" })],
      emptyP,
    );
    expect(diff.conflicts.length).toBe(1);
    expect(diff.conflicts[0].local).toBe("X");
    expect(diff.conflicts[0].server).toBe("Y");
  });

  // (12) Fresh checkout, new local key → push as new
  it("fresh checkout with brand-new local key pushes it cleanly", () => {
    const diff = diffThreeWay(
      [L({ en_us: "fresh" })],
      [],
      emptyP,
    );
    expect(diff.toPush.length).toBe(1);
    expect(diff.conflicts.length).toBe(0);
  });

  // Regression: fresh checkout where server has a lang local doesn't.
  // Before the fix, this misrouted to localDeletions because the
  // synthesized P had `p === s` for every lang the server had.
  it("fresh checkout: server has a lang local doesn't → serverOnly, NOT localDeletion", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x", es_ar: "hola" })],
      emptyP,
    );
    expect(diff.serverOnly.length).toBe(1);
    expect(diff.serverOnly[0].lang).toBe("es_ar");
    expect(diff.serverOnly[0].value).toBe("hola");
    expect(diff.localDeletions.length).toBe(0);
    expect(diff.conflicts.length).toBe(0);
  });

  // Local lang absent when server changed it — still serverOnly bring-in (not a delete)
  it("local lang absent + server changed lang since baseline → serverOnly bring-in", () => {
    const diff = diffThreeWay(
      [L({ en_us: "x" })],
      [S({ en_us: "x", es_ar: "new" })],
      P({ en_us: "x", es_ar: "old" }),
    );
    expect(diff.serverOnly.length).toBe(1);
    expect(diff.serverOnly[0].lang).toBe("es_ar");
    expect(diff.serverOnly[0].value).toBe("new");
    expect(diff.localDeletions.length).toBe(0);
  });
});

describe("buildNextState", () => {
  it("captures server snapshot + overlays just-pushed values", () => {
    const serverWordings: Wording[] = [
      {
        key: "title",
        namespace: "common",
        value_json: { en_us: "Hello", es_ar: "Hola" },
        updated_at: "2026-05-12T09:00:00Z",
      },
    ];
    const pushed = { "common:title": { en_us: "Hi" } };
    const next = buildNextState(serverWordings, pushed);
    expect(next.version).toBe(2);
    // Pushed lang reflects the client value; untouched lang reflects server.
    expect(next.wordings["common:title"].values).toEqual({
      en_us: "Hi",
      es_ar: "Hola",
    });
    expect(next.wordings["common:title"].updated_at).toBe(
      "2026-05-12T09:00:00Z",
    );
  });

  it("handles empty pushed map (post-pull baseline only)", () => {
    const serverWordings: Wording[] = [
      {
        key: "k",
        namespace: "ns",
        value_json: { en_us: "x" },
        updated_at: "2026-05-12T08:00:00Z",
      },
    ];
    const next = buildNextState(serverWordings, {});
    expect(next.wordings["ns:k"].values).toEqual({ en_us: "x" });
  });
});

const SUPPORTED_CODES = [
  "en_us",
  "es_es",
  "fr_fr",
  "pt_br",
  "de_de",
  "ja_jp",
  "zh_cn",
];

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
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      input,
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({ en_us: "Hello", es_es: "Hola" });
    expect(mappings.size).toBe(0);
    expect(unsupported).toEqual([]);
  });

  it("normalizes hyphenated codes and tracks mappings", () => {
    const input = { "en-US": "Hello", "pt-BR": "Olá" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      input,
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({ en_us: "Hello", pt_br: "Olá" });
    expect(mappings.get("en-US")).toBe("en_us");
    expect(mappings.get("pt-BR")).toBe("pt_br");
    expect(unsupported).toEqual([]);
  });

  it("expands short codes and tracks mappings", () => {
    const input = { en: "Hello", fr: "Bonjour" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      input,
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({ en_us: "Hello", fr_fr: "Bonjour" });
    expect(mappings.get("en")).toBe("en_us");
    expect(mappings.get("fr")).toBe("fr_fr");
  });

  it("collects unsupported codes", () => {
    const input = { en_us: "Hello", xx: "Unknown", yy_zz: "Also unknown" };
    const { normalized, unsupported } = normalizeWordingLanguages(
      input,
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({ en_us: "Hello" });
    expect(unsupported).toEqual(["xx", "yy_zz"]);
  });

  it("handles mixed valid and invalid codes", () => {
    const input = { en: "Hello", "pt-BR": "Olá", xx: "Bad" };
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      input,
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({ en_us: "Hello", pt_br: "Olá" });
    expect(mappings.size).toBe(2);
    expect(unsupported).toEqual(["xx"]);
  });

  it("handles empty input", () => {
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      {},
      SUPPORTED_CODES,
    );
    expect(normalized).toEqual({});
    expect(mappings.size).toBe(0);
    expect(unsupported).toEqual([]);
  });
});
