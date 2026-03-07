import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detect } from "../src/detector/index.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "i1n-detect-"));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

describe("detector", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => cleanup(dir));

  it("returns null for empty directory", () => {
    expect(detect(dir)).toBeNull();
  });

  it("detects next-intl from package.json", () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "next-intl": "^3.0.0" },
    }));
    fs.mkdirSync(path.join(dir, "messages"), { recursive: true });

    const result = detect(dir);
    expect(result?.framework).toBe("next-intl");
    expect(result?.format).toBe("nested-json");
    expect(result?.localesDir).toBe("messages");
  });

  it("detects react-i18next from package.json", () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "react-i18next": "^14.0.0" },
    }));
    fs.mkdirSync(path.join(dir, "public/locales"), { recursive: true });

    const result = detect(dir);
    expect(result?.framework).toBe("i18next");
    expect(result?.format).toBe("nested-json");
    expect(result?.localesDir).toBe("public/locales");
  });

  it("detects i18next from devDependencies", () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      devDependencies: { "i18next": "^23.0.0" },
    }));

    const result = detect(dir);
    expect(result?.framework).toBe("i18next");
  });

  it("detects vue-i18n", () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "vue-i18n": "^9.0.0" },
    }));
    fs.mkdirSync(path.join(dir, "src/locales"), { recursive: true });

    const result = detect(dir);
    expect(result?.framework).toBe("vue-i18n");
    expect(result?.localesDir).toBe("src/locales");
  });

  it("detects flutter from pubspec.yaml", () => {
    writeFile(path.join(dir, "pubspec.yaml"), "dependencies:\n  flutter_localizations:\n    sdk: flutter\n");

    const result = detect(dir);
    expect(result?.framework).toBe("flutter");
    expect(result?.format).toBe("arb");
  });

  it("detects rails from Gemfile", () => {
    writeFile(path.join(dir, "Gemfile"), "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\n");

    const result = detect(dir);
    expect(result?.framework).toBe("rails");
    expect(result?.format).toBe("yaml");
  });

  it("detects android from filesystem", () => {
    writeFile(path.join(dir, "app/src/main/res/values/strings.xml"), `<?xml version="1.0"?>\n<resources>\n    <string name="app">App</string>\n</resources>`);

    const result = detect(dir);
    expect(result?.framework).toBe("android");
    expect(result?.format).toBe("android-xml");
  });

  it("detects ios from filesystem", () => {
    fs.mkdirSync(path.join(dir, "locales/en.lproj"), { recursive: true });
    writeFile(path.join(dir, "locales/en.lproj/Localizable.strings"), '"hello" = "Hello";\n');

    const result = detect(dir);
    expect(result?.framework).toBe("ios");
    expect(result?.format).toBe("apple-strings");
  });

  it("detects generic json from locale directories", () => {
    writeFile(path.join(dir, "locales/en/common.json"), JSON.stringify({ key: "value" }));
    writeFile(path.join(dir, "locales/es/common.json"), JSON.stringify({ key: "valor" }));

    const result = detect(dir);
    expect(result?.framework).toBe("generic");
    expect(result?.format).toBe("nested-json");
    expect(result?.localesDir).toBe("locales");
  });

  it("detects typescript format from locale directories", () => {
    writeFile(path.join(dir, "locales/en/common.ts"), `export default { key: "value" } as const;\n`);

    const result = detect(dir);
    expect(result?.framework).toBe("generic");
    expect(result?.format).toBe("typescript");
  });

  it("detects source locale prioritizing 'en'", () => {
    writeFile(path.join(dir, "locales/en/common.json"), JSON.stringify({ key: "value" }));
    writeFile(path.join(dir, "locales/fr/common.json"), JSON.stringify({ key: "valeur" }));

    const result = detect(dir);
    expect(result?.sourceLocale).toBe("en");
  });

  it("falls back to largest directory for source locale", () => {
    writeFile(path.join(dir, "locales/fr/a.json"), JSON.stringify({ key: "valeur" }));
    writeFile(path.join(dir, "locales/fr/b.json"), JSON.stringify({ other: "autre" }));
    writeFile(path.join(dir, "locales/de/a.json"), JSON.stringify({ k: "v" }));

    const result = detect(dir);
    expect(result?.sourceLocale).toBe("fr");
  });

  it("detects arb files in filesystem", () => {
    writeFile(path.join(dir, "lib/l10n/app_en.arb"), JSON.stringify({ "@@locale": "en", "hello": "Hello" }));

    const result = detect(dir);
    expect(result?.framework).toBe("flutter");
    expect(result?.format).toBe("arb");
  });

  it("handles corrupt package.json gracefully", () => {
    writeFile(path.join(dir, "package.json"), "NOT JSON {{");
    expect(detect(dir)).toBeNull();
  });

  it("picks first matching directory for dep signals", () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "react-i18next": "^14.0.0" },
    }));
    fs.mkdirSync(path.join(dir, "src/locales"), { recursive: true });

    const result = detect(dir);
    expect(result?.localesDir).toBe("src/locales");
  });
});
