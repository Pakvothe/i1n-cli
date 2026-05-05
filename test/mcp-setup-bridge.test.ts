import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleSetupBridge } from "../src/mcp/tools/setup-bridge.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "i1n-mcp-bridge-"));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function validConfig(framework: string, localesDir = "src/locales", format = "nested-json", sourceLocale = "en") {
  return {
    apiKey: "i1n_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: "11111111-1111-1111-1111-111111111111",
    localesDir,
    sourceLocale,
    format,
    framework,
  };
}

function payload(result: Awaited<ReturnType<typeof handleSetupBridge>>) {
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

describe("mcp setup-bridge", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => cleanup(dir));

  it("reports no_library when nothing is detected and no i18n-like dep exists", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { lodash: "^4.0.0" },
    }));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("no_library");
    expect(data.recommendation).toContain("i1n init");
    expect(data.configExists).toBe(false);
  });

  it("reports library_not_js_ts for Flutter projects", async () => {
    writeFile(path.join(dir, "pubspec.yaml"), "dependencies:\n  flutter_localizations:\n    sdk: flutter\n");

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("library_not_js_ts");
    expect(data.framework).toBe("flutter");
    expect(data.recommendation).toContain("i1n init");
  });

  it("returns needs_api_key when i18next is detected but no config and no apiKey", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("needs_api_key");
    expect(data.framework).toBe("i18next");
    expect(data.hint).toContain("apiKey");
    expect(data.alternative).toContain("i1n init");
  });

  it("returns invalid_api_key when apiKey format is wrong", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));

    const result = await handleSetupBridge({ cwd: dir, apiKey: "not-a-valid-key" });
    const data = payload(result);

    expect(data.status).toBe("invalid_api_key");
    expect(data.message).toContain("i1n_");
  });

  it("returns needs_api_key for unknown i18n-like deps without config or apiKey", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "react-intl": "^6.0.0" },
    }));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("needs_api_key");
    expect(data.detectedDependency).toBe("react-intl");
    expect(data.inferred).toBe(true);
  });

  it("returns ready_for_bridge with i18next snippet when config exists", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("ready_for_bridge");
    expect(data.inferred).toBe(false);
    expect(data.framework).toBe("i18next");
    expect(data.bridge.snippet).toContain("i18next.t(key, params)");
    expect(data.bridge.snippet).toContain("registerI1n");
    expect(data.bridge.written).toBe(false);
  });

  it("writes the bridge file when write=true (TS when tsconfig.json exists)", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir, write: true });
    const data = payload(result);

    expect(data.bridge.written).toBe(true);
    expect(data.bridge.suggestedPath).toBe("src/i18n/i1n-bridge.ts");

    const writtenPath = path.join(dir, "src/i18n/i1n-bridge.ts");
    expect(fs.existsSync(writtenPath)).toBe(true);
    const content = fs.readFileSync(writtenPath, "utf-8");
    expect(content).toContain("export function setupI1nBridge()");
    expect(content).toContain("i18next.t(key, params)");
  });

  it("falls back to .js extension when no tsconfig and no .ts files in src/", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "src/index.js"), "");
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir, write: true });
    const data = payload(result);

    expect(data.bridge.suggestedPath).toBe("src/i18n/i1n-bridge.js");
    expect(fs.existsSync(path.join(dir, "src/i18n/i1n-bridge.js"))).toBe(true);
  });

  it("infers a snippet for unknown i18n-like dependencies (react-intl)", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "react-intl": "^6.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("generic")));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    // generic is a known framework in our table, so this comes back as ready_for_bridge,
    // but the dependency itself isn't in our known list — so detectFramework returns null
    // and we hit the unknown-dep branch with config present.
    expect(data.status).toBe("ready_for_bridge_inferred");
    expect(data.inferred).toBe(true);
    expect(data.detectedDependency).toBe("react-intl");
    expect(data.bridge.snippet).toContain("formatMessage");
    expect(data.verificationHint).toContain("best-effort");
  });

  it("infers a snippet with t(key, params) for unknown libs without 'intl' in name", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { "@my-org/translate-core": "^1.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("generic")));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("ready_for_bridge_inferred");
    expect(data.inferred).toBe(true);
    expect(data.detectedDependency).toBe("@my-org/translate-core");
    expect(data.bridge.snippet).toContain(".t(key, params)");
  });

  it("rejects absolute bridgePath", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir, write: true, bridgePath: "/etc/evil.ts" });
    const data = payload(result);

    expect(data.status).toBe("invalid_bridge_path");
    expect(fs.existsSync("/etc/evil.ts")).toBe(false);
  });

  it("rejects bridgePath with parent traversal", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir, write: true, bridgePath: "../escape.ts" });
    const data = payload(result);

    expect(data.status).toBe("invalid_bridge_path");
  });

  it("rejects bridgePath without .ts/.js extension", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));

    const result = await handleSetupBridge({ cwd: dir, write: true, bridgePath: "src/bridge" });
    const data = payload(result);

    expect(data.status).toBe("invalid_bridge_path");
  });

  it("ignores deps with malicious-looking names that don't match npm naming rules", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { 'evil"i18n\nlib': "^1.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("generic")));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    // Detector returns null (no known dep); findUnknownI18nDep skips invalid names → no_library
    expect(data.status).toBe("no_library");
  });

  it("reports overwrote=true when an existing bridge file is replaced", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("i18next")));
    writeFile(path.join(dir, "src/i18n/i1n-bridge.js"), "// previous content");

    const result = await handleSetupBridge({ cwd: dir, write: true });
    const data = payload(result);

    expect(data.bridge.written).toBe(true);
    expect(data.bridge.overwrote).toBe(true);
  });

  it("flags mismatch when configured framework differs from detected", async () => {
    writeFile(path.join(dir, "package.json"), JSON.stringify({
      dependencies: { i18next: "^23.0.0" },
    }));
    writeFile(path.join(dir, "i1n.config.json"), JSON.stringify(validConfig("vue-i18n")));

    const result = await handleSetupBridge({ cwd: dir });
    const data = payload(result);

    expect(data.status).toBe("ready_for_bridge");
    expect(data.framework).toBe("vue-i18n");
    expect(data.mismatch).not.toBeNull();
    expect(data.mismatch.detected).toBe("i18next");
    expect(data.mismatch.configured).toBe("vue-i18n");
    expect(data.bridge.snippet).toContain("i18n.global.t");
  });
});
