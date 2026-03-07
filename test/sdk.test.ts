import { describe, it, expect, beforeEach } from "bun:test";
import { init, t } from "../src/sdk/runtime.js";

describe("sdk runtime", () => {
  beforeEach(() => {
    init({
      locale: "en",
      translations: {
        common: {
          greeting: "Hello {name}",
          simple: "Just text",
          multi: "{{a}} and %{b}",
        },
        errors: {
          notFound: "Page not found",
        },
      },
    });
  });

  it("returns value for existing key", () => {
    expect(t("common.simple")).toBe("Just text");
  });

  it("replaces variables in value", () => {
    expect(t("common.greeting", { name: "World" })).toBe("Hello World");
  });

  it("handles multiple variable syntaxes", () => {
    expect(t("common.multi", { a: "X", b: "Y" })).toBe("X and Y");
  });

  it("returns key for missing translation", () => {
    expect(t("common.missing")).toBe("common.missing");
  });

  it("returns key for missing namespace", () => {
    expect(t("unknown.key")).toBe("unknown.key");
  });

  it("returns key if no dot separator", () => {
    expect(t("noDot")).toBe("noDot");
  });

  it("works across namespaces", () => {
    expect(t("errors.notFound")).toBe("Page not found");
  });

  it("returns value without replacing if no variables passed", () => {
    expect(t("common.greeting")).toBe("Hello {name}");
  });
});
