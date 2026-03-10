import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { jsonNestedParser } from "../src/parsers/json-nested.js";
import { jsonFlatParser } from "../src/parsers/json-flat.js";
import { arbParser } from "../src/parsers/arb.js";
import { yamlParser } from "../src/parsers/yaml.js";
import { androidXmlParser } from "../src/parsers/android-xml.js";
import { appleStringsParser } from "../src/parsers/apple-strings.js";
import { typescriptParser } from "../src/parsers/typescript.js";
import type { Wording, Language } from "../src/shared/types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "i1n-test-"));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function findWording(
  wordings: Wording[],
  key: string,
  namespace?: string,
): Wording | undefined {
  return wordings.find(
    (w) => w.key === key && (!namespace || w.namespace === namespace),
  );
}

const LANGS: Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
];

describe("json-nested parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads nested json files across locales", () => {
    writeFile(
      path.join(dir, "en/common.json"),
      JSON.stringify({
        greeting: "Hello",
        nested: { deep: "World" },
      }),
    );
    writeFile(
      path.join(dir, "es/common.json"),
      JSON.stringify({
        greeting: "Hola",
        nested: { deep: "Mundo" },
      }),
    );

    const { wordings, warnings } = jsonNestedParser.read(dir, "en");

    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(2);

    const greeting = findWording(wordings, "greeting", "common");
    expect(greeting?.value_json.en).toBe("Hello");
    expect(greeting?.value_json.es).toBe("Hola");

    const deep = findWording(wordings, "nested.deep", "common");
    expect(deep?.value_json.en).toBe("World");
  });

  it("handles multiple namespaces", () => {
    writeFile(path.join(dir, "en/common.json"), JSON.stringify({ ok: "OK" }));
    writeFile(
      path.join(dir, "en/errors.json"),
      JSON.stringify({ notFound: "Not Found" }),
    );

    const { wordings } = jsonNestedParser.read(dir, "en");
    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "ok", "common")).toBeDefined();
    expect(findWording(wordings, "notFound", "errors")).toBeDefined();
  });

  it("warns on corrupt json", () => {
    writeFile(path.join(dir, "en/broken.json"), "NOT JSON {{{");
    writeFile(
      path.join(dir, "en/valid.json"),
      JSON.stringify({ key: "value" }),
    );

    const { wordings, warnings } = jsonNestedParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Failed to parse JSON");
    expect(warnings[0].file).toContain("broken.json");
    expect(wordings).toHaveLength(1);
  });

  it("warns when json is not an object", () => {
    writeFile(path.join(dir, "en/arr.json"), JSON.stringify([1, 2, 3]));

    const { warnings } = jsonNestedParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Expected a JSON object");
  });

  it("returns empty for non-existent directory", () => {
    const { wordings, warnings } = jsonNestedParser.read(
      "/tmp/does-not-exist-i1n",
      "en",
    );
    expect(wordings).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("ignores directories that don't match locale pattern", () => {
    writeFile(
      path.join(dir, "node_modules/file.json"),
      JSON.stringify({ a: "b" }),
    );
    writeFile(path.join(dir, ".cache/file.json"), JSON.stringify({ a: "b" }));

    const { wordings } = jsonNestedParser.read(dir, "en");
    expect(wordings).toHaveLength(0);
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "hello",
        namespace: "common",
        value_json: { en: "Hello", es: "Hola" },
      },
      {
        key: "nested.key",
        namespace: "common",
        value_json: { en: "Nested", es: "Anidado" },
      },
    ];

    jsonNestedParser.write(dir, original, LANGS);
    const { wordings } = jsonNestedParser.read(dir, "en");

    expect(wordings).toHaveLength(2);
    const hello = findWording(wordings, "hello", "common");
    expect(hello?.value_json.en).toBe("Hello");
    expect(hello?.value_json.es).toBe("Hola");

    const nested = findWording(wordings, "nested.key", "common");
    expect(nested?.value_json.en).toBe("Nested");
  });

  it("converts numbers and booleans to strings", () => {
    writeFile(
      path.join(dir, "en/common.json"),
      JSON.stringify({
        count: 42,
        active: true,
      }),
    );

    const { wordings } = jsonNestedParser.read(dir, "en");
    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "count")?.value_json.en).toBe("42");
    expect(findWording(wordings, "active")?.value_json.en).toBe("true");
  });

  it("strips redundant namespace when writing dirty keys", () => {
    const wordings: Wording[] = [
      { key: "common.hello", namespace: "common", value_json: { en: "Hi" } },
    ];

    jsonNestedParser.write(dir, wordings, LANGS);
    const filePath = path.join(dir, "en/common.json");
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // Should NOT be { "common": { "hello": "Hi" } }
    // Should BE { "hello": "Hi" }
    expect(content.common).toBeUndefined();
    expect(content.hello).toBe("Hi");
  });
});

describe("json-flat parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads flat key-value pairs", () => {
    writeFile(
      path.join(dir, "en/common.json"),
      JSON.stringify({
        greeting: "Hello",
        "nav.home": "Home",
      }),
    );

    const { wordings } = jsonFlatParser.read(dir, "en");
    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "greeting")?.value_json.en).toBe("Hello");
    expect(findWording(wordings, "nav.home")?.value_json.en).toBe("Home");
  });

  it("warns on non-string values", () => {
    writeFile(
      path.join(dir, "en/common.json"),
      JSON.stringify({
        valid: "string",
        nested: { not: "flat" },
        number: 123,
      }),
    );

    const { wordings, warnings } = jsonFlatParser.read(dir, "en");
    expect(wordings).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.message.includes("non-string value"))).toBe(
      true,
    );
  });

  it("warns on corrupt json", () => {
    writeFile(path.join(dir, "en/bad.json"), "{invalid");

    const { warnings } = jsonFlatParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Failed to parse JSON");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "title",
        namespace: "ui",
        value_json: { en: "Title", es: "Título" },
      },
    ];

    jsonFlatParser.write(dir, original, LANGS);
    const { wordings } = jsonFlatParser.read(dir, "en");

    expect(wordings).toHaveLength(1);
    expect(findWording(wordings, "title", "ui")?.value_json.en).toBe("Title");
    expect(findWording(wordings, "title", "ui")?.value_json.es).toBe("Título");
  });
});

describe("arb parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads arb files with @@locale", () => {
    writeFile(
      path.join(dir, "app_en.arb"),
      JSON.stringify({
        "@@locale": "en",
        hello: "Hello",
        "@hello": { description: "Greeting" },
      }),
    );
    writeFile(
      path.join(dir, "app_es.arb"),
      JSON.stringify({
        "@@locale": "es",
        hello: "Hola",
      }),
    );

    const { wordings, warnings } = arbParser.read(dir, "en");
    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(1);

    const hello = findWording(wordings, "hello");
    expect(hello?.value_json.en).toBe("Hello");
    expect(hello?.value_json.es).toBe("Hola");
    expect(hello?.description).toBe("Greeting");
    expect(hello?.namespace).toBe("l10n");
  });

  it("extracts locale from filename when @@locale missing", () => {
    writeFile(
      path.join(dir, "app_fr.arb"),
      JSON.stringify({ bonjour: "Bonjour" }),
    );

    const { wordings } = arbParser.read(dir, "fr");
    expect(wordings).toHaveLength(1);
    expect(findWording(wordings, "bonjour")?.value_json.fr).toBe("Bonjour");
  });

  it("warns when locale cannot be determined", () => {
    writeFile(path.join(dir, "random.arb"), JSON.stringify({ key: "value" }));

    const { warnings } = arbParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Could not determine locale");
  });

  it("warns on corrupt arb", () => {
    writeFile(path.join(dir, "app_en.arb"), "NOT JSON");

    const { warnings } = arbParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Failed to parse ARB");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "greeting",
        namespace: "l10n",
        value_json: { en: "Hi", es: "Hola" },
        description: "A greeting",
      },
    ];

    arbParser.write(dir, original, LANGS);
    const { wordings } = arbParser.read(dir, "en");

    expect(wordings).toHaveLength(1);
    const w = findWording(wordings, "greeting");
    expect(w?.value_json.en).toBe("Hi");
    expect(w?.value_json.es).toBe("Hola");
    expect(w?.description).toBe("A greeting");
  });
});

describe("yaml parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads rails-style yaml files", () => {
    writeFile(
      path.join(dir, "en.yml"),
      `en:\n  activerecord:\n    errors:\n      blank: "can't be blank"\n`,
    );
    writeFile(
      path.join(dir, "es.yml"),
      `es:\n  activerecord:\n    errors:\n      blank: "no puede estar vacío"\n`,
    );

    const { wordings, warnings } = yamlParser.read(dir, "en");
    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(1);

    const w = findWording(wordings, "errors.blank", "activerecord");
    expect(w?.value_json.en).toBe("can't be blank");
    expect(w?.value_json.es).toBe("no puede estar vacío");
  });

  it("warns on corrupt yaml", () => {
    writeFile(path.join(dir, "en.yml"), ":\n  - [\n  invalid:");

    const { warnings } = yamlParser.read(dir, "en");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns when root key doesn't contain an object", () => {
    writeFile(path.join(dir, "en.yml"), `en: "just a string"\n`);

    const { warnings } = yamlParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("does not contain an object");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "title",
        namespace: "pages",
        value_json: { en: "Home", es: "Inicio" },
      },
    ];

    yamlParser.write(dir, original, LANGS);
    const { wordings } = yamlParser.read(dir, "en");

    expect(wordings).toHaveLength(1);
    const w = findWording(wordings, "title", "pages");
    expect(w?.value_json.en).toBe("Home");
    expect(w?.value_json.es).toBe("Inicio");
  });
});

describe("android-xml parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads strings.xml from values directories", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My App</string>
    <string name="hello">Hello World</string>
</resources>`;

    writeFile(path.join(dir, "values/strings.xml"), xml);

    const { wordings, warnings } = androidXmlParser.read(dir, "en");
    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "app_name")?.value_json.en).toBe("My App");
    expect(findWording(wordings, "hello")?.value_json.en).toBe("Hello World");
  });

  it("reads multiple locale directories", () => {
    const enXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="ok">OK</string>\n</resources>`;
    const esXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="ok">Aceptar</string>\n</resources>`;

    writeFile(path.join(dir, "values/strings.xml"), enXml);
    writeFile(path.join(dir, "values-es/strings.xml"), esXml);

    const { wordings } = androidXmlParser.read(dir, "en");
    const ok = findWording(wordings, "ok");
    expect(ok?.value_json.en).toBe("OK");
    expect(ok?.value_json.es).toBe("Aceptar");
  });

  it("reads plurals", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`;

    writeFile(path.join(dir, "values/strings.xml"), xml);
    const { wordings } = androidXmlParser.read(dir, "en");

    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "items_one")?.value_json.en).toBe("%d item");
    expect(findWording(wordings, "items_other")?.value_json.en).toBe(
      "%d items",
    );
  });

  it("handles xml entity escaping", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="terms">Terms &amp; Conditions</string>
    <string name="quote">She said &quot;hello&quot;</string>
    <string name="apos">It&apos;s fine</string>
</resources>`;

    writeFile(path.join(dir, "values/strings.xml"), xml);
    const { wordings } = androidXmlParser.read(dir, "en");

    expect(findWording(wordings, "terms")?.value_json.en).toBe(
      "Terms & Conditions",
    );
    expect(findWording(wordings, "quote")?.value_json.en).toBe(
      'She said "hello"',
    );
    expect(findWording(wordings, "apos")?.value_json.en).toBe("It's fine");
  });

  it("warns on invalid xml file", () => {
    writeFile(path.join(dir, "values/strings.xml"), "not xml at all");

    const { warnings } = androidXmlParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Not a valid Android resources XML");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "title",
        namespace: "strings",
        value_json: { en: "App", es: "Aplicación" },
      },
      { key: "ampersand", namespace: "strings", value_json: { en: "A & B" } },
    ];

    androidXmlParser.write(dir, original, LANGS);
    const { wordings } = androidXmlParser.read(dir, "en");

    expect(findWording(wordings, "title")?.value_json.en).toBe("App");
    expect(findWording(wordings, "title")?.value_json.es).toBe("Aplicación");
    expect(findWording(wordings, "ampersand")?.value_json.en).toBe("A & B");
  });
});

describe("apple-strings parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads .lproj files", () => {
    writeFile(
      path.join(dir, "en.lproj/Localizable.strings"),
      `"hello" = "Hello";\n"world" = "World";\n`,
    );
    writeFile(
      path.join(dir, "es.lproj/Localizable.strings"),
      `"hello" = "Hola";\n"world" = "Mundo";\n`,
    );

    const { wordings, warnings } = appleStringsParser.read(dir, "en");
    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(2);

    const hello = findWording(wordings, "hello");
    expect(hello?.value_json.en).toBe("Hello");
    expect(hello?.value_json.es).toBe("Hola");
    expect(hello?.namespace).toBe("localizable");
  });

  it("reads comments as descriptions", () => {
    const content = `/* A greeting message */\n"greeting" = "Hello";\n`;
    writeFile(path.join(dir, "en.lproj/Localizable.strings"), content);

    const { wordings } = appleStringsParser.read(dir, "en");
    expect(findWording(wordings, "greeting")?.description).toBe(
      "A greeting message",
    );
  });

  it("handles escape sequences", () => {
    writeFile(
      path.join(dir, "en.lproj/Localizable.strings"),
      `"line" = "first\\nsecond";\n"quote" = "say \\"hi\\"";\n"backslash" = "path\\\\dir";\n`,
    );

    const { wordings } = appleStringsParser.read(dir, "en");
    expect(findWording(wordings, "line")?.value_json.en).toBe("first\nsecond");
    expect(findWording(wordings, "quote")?.value_json.en).toBe('say "hi"');
    expect(findWording(wordings, "backslash")?.value_json.en).toBe("path\\dir");
  });

  it("warns on non-empty file with no entries", () => {
    writeFile(
      path.join(dir, "en.lproj/Localizable.strings"),
      "this is not a strings file\n",
    );

    const { warnings } = appleStringsParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("no valid entries");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "greeting",
        namespace: "localizable",
        value_json: { en: "Hello", es: "Hola" },
      },
      {
        key: "with_newline",
        namespace: "localizable",
        value_json: { en: "line1\nline2" },
      },
    ];

    appleStringsParser.write(dir, original, LANGS);
    const { wordings } = appleStringsParser.read(dir, "en");

    expect(findWording(wordings, "greeting")?.value_json.en).toBe("Hello");
    expect(findWording(wordings, "greeting")?.value_json.es).toBe("Hola");
    expect(findWording(wordings, "with_newline")?.value_json.en).toBe(
      "line1\nline2",
    );
  });
});

describe("typescript parser", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => cleanup(dir));

  it("reads export default objects", () => {
    writeFile(
      path.join(dir, "en/common.ts"),
      `export default {\n  hello: "Hello",\n  nested: {\n    key: "Value"\n  }\n} as const;\n`,
    );

    const { wordings, warnings } = typescriptParser.read(dir, "en");
    expect(warnings).toHaveLength(0);
    expect(wordings).toHaveLength(2);
    expect(findWording(wordings, "hello")?.value_json.en).toBe("Hello");
    expect(findWording(wordings, "nested.key")?.value_json.en).toBe("Value");
  });

  it("reads .js files too", () => {
    writeFile(
      path.join(dir, "en/ui.js"),
      `export default {\n  title: "Title"\n};\n`,
    );

    const { wordings } = typescriptParser.read(dir, "en");
    expect(wordings).toHaveLength(1);
    expect(findWording(wordings, "title")?.value_json.en).toBe("Title");
  });

  it("warns when no default export found", () => {
    writeFile(
      path.join(dir, "en/bad.ts"),
      `export const translations = { key: "value" };\n`,
    );

    const { warnings } = typescriptParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("No default export object found");
  });

  it("warns when object literal can't be parsed", () => {
    writeFile(
      path.join(dir, "en/bad.ts"),
      `export default {\n  key: someVariable,\n};\n`,
    );

    const { warnings } = typescriptParser.read(dir, "en");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Could not parse");
  });

  it("roundtrips correctly", () => {
    const original: Wording[] = [
      {
        key: "greeting",
        namespace: "common",
        value_json: { en: "Hi", es: "Hola" },
      },
    ];

    typescriptParser.write(dir, original, LANGS);
    const { wordings } = typescriptParser.read(dir, "en");

    expect(wordings).toHaveLength(1);
    expect(findWording(wordings, "greeting")?.value_json.en).toBe("Hi");
    expect(findWording(wordings, "greeting")?.value_json.es).toBe("Hola");
  });
});
