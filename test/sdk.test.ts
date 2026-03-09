import { describe, it, expect, beforeEach } from "bun:test";
import { init, t, setLocale, getLocale, registerI1n } from "../src/sdk/runtime.js";

describe("sdk runtime", () => {
  // ─── Nested Resolution ──────────────────────────────────────────────
  describe("nested key resolution", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            common: {
              greeting: "Hello {name}",
              simple: "Just text",
              multi: "{{a}} and %{b}",
            },
            auth: {
              login: {
                submit: "Sign In",
                title: "Welcome back",
              },
            },
            errors: {
              notFound: "Page not found",
            },
          },
        },
      });
    });

    it("resolves simple nested key", () => {
      expect(t("common.simple")).toBe("Just text");
    });

    it("resolves deeply nested key", () => {
      expect(t("auth.login.submit")).toBe("Sign In");
    });

    it("replaces {var} syntax variables", () => {
      expect(t("common.greeting", { name: "World" })).toBe("Hello World");
    });

    it("handles multiple variable syntaxes in one string", () => {
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

    it("returns value without replacing if no variables passed", () => {
      expect(t("common.greeting")).toBe("Hello {name}");
    });

    it("works across namespaces", () => {
      expect(t("errors.notFound")).toBe("Page not found");
    });
  });

  // ─── Flat Key Resolution ──────────────────────────────────────────
  describe("flat key resolution (fallback)", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            "common.greeting": "Hello {name}",
            "common.simple": "Just text",
            "auth.login.submit": "Sign In",
          },
        },
      });
    });

    it("resolves flat key directly", () => {
      expect(t("common.simple")).toBe("Just text");
    });

    it("resolves flat deeply dotted key", () => {
      expect(t("auth.login.submit")).toBe("Sign In");
    });

    it("interpolates variables in flat key values", () => {
      expect(t("common.greeting", { name: "Fran" })).toBe("Hello Fran");
    });

    it("returns key for missing flat key", () => {
      expect(t("common.missing")).toBe("common.missing");
    });
  });

  // ─── Mixed Structure (nested + flat coexist) ───────────────────────
  describe("mixed nested and flat structure", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            common: {
              greeting: "Hello from nested",
            },
            "errors.notFound": "Flat error",
          },
        },
      });
    });

    it("resolves nested key first", () => {
      expect(t("common.greeting")).toBe("Hello from nested");
    });

    it("falls back to flat key", () => {
      expect(t("errors.notFound")).toBe("Flat error");
    });
  });

  // ─── Pluralization ──────────────────────────────────────────────────
  describe("pluralization", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            items_zero: "No items",
            items_one: "One item",
            items_other: "{count} items",
            messages_one: "{name} has one message",
            messages_other: "{name} has {count} messages",
          },
        },
      });
    });

    it("resolves _zero variant for count=0", () => {
      expect(t("items", { count: 0 })).toBe("No items");
    });

    it("resolves _one variant for count=1", () => {
      expect(t("items", { count: 1 })).toBe("One item");
    });

    it("resolves _other variant for count > 1", () => {
      expect(t("items", { count: 5 })).toBe("5 items");
    });

    it("interpolates count as a number in the value", () => {
      expect(t("items", { count: 42 })).toBe("42 items");
    });

    it("interpolates count + other variables together", () => {
      expect(t("messages", { count: 3, name: "Alice" })).toBe("Alice has 3 messages");
    });

    it("interpolates count=1 + other variables", () => {
      expect(t("messages", { count: 1, name: "Bob" })).toBe("Bob has one message");
    });

    it("falls back to _other when _zero is missing", () => {
      init({
        locale: "en_us",
        resources: {
          en_us: {
            tasks_one: "One task",
            tasks_other: "{count} tasks",
          },
        },
      });
      expect(t("tasks", { count: 0 })).toBe("0 tasks");
    });

    it("falls back to base key when no plural variants exist", () => {
      init({
        locale: "en_us",
        resources: {
          en_us: {
            items: "Some items",
          },
        },
      });
      expect(t("items", { count: 5 })).toBe("Some items");
    });
  });

  // ─── Nested Pluralization ──────────────────────────────────────────
  describe("pluralization with nested keys", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            shop: {
              items_zero: "Your cart is empty",
              items_one: "One item in cart",
              items_other: "{count} items in cart",
            },
          },
        },
      });
    });

    it("resolves nested plural _zero", () => {
      expect(t("shop.items", { count: 0 })).toBe("Your cart is empty");
    });

    it("resolves nested plural _one", () => {
      expect(t("shop.items", { count: 1 })).toBe("One item in cart");
    });

    it("resolves nested plural _other", () => {
      expect(t("shop.items", { count: 10 })).toBe("10 items in cart");
    });
  });

  // ─── setLocale / getLocale ──────────────────────────────────────────
  describe("setLocale / getLocale", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: { greeting: "Hello" },
          es_es: { greeting: "Hola" },
          fr_fr: { greeting: "Bonjour" },
        },
      });
    });

    it("returns the initial locale", () => {
      expect(getLocale()).toBe("en_us");
    });

    it("translates using the initial locale", () => {
      expect(t("greeting")).toBe("Hello");
    });

    it("switches locale and translates correctly", () => {
      setLocale("es_es");
      expect(getLocale()).toBe("es_es");
      expect(t("greeting")).toBe("Hola");
    });

    it("switches locale multiple times", () => {
      setLocale("fr_fr");
      expect(t("greeting")).toBe("Bonjour");
      setLocale("en_us");
      expect(t("greeting")).toBe("Hello");
    });

    it("returns key when locale has no resources", () => {
      setLocale("de_de");
      expect(t("greeting")).toBe("greeting");
    });
  });

  // ─── registerI1n (Bridge Mode) ─────────────────────────────────────
  describe("registerI1n (bridge mode)", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: { greeting: "Native Hello" },
        },
      });
    });

    it("delegates to engine when registered", () => {
      registerI1n((key) => `Bridge: ${key}`);
      expect(t("greeting")).toBe("Bridge: greeting");
    });

    it("passes variables to engine", () => {
      registerI1n((key, params) => `${key} with ${params?.name}`);
      expect(t("greeting", { name: "World" })).toBe("greeting with World");
    });

    it("engine receives the exact key and params", () => {
      let receivedKey = "";
      let receivedParams: any = null;

      registerI1n((key, params) => {
        receivedKey = key;
        receivedParams = params;
        return "ok";
      });

      t("my.deep.key", { count: 5, name: "X" });
      expect(receivedKey).toBe("my.deep.key");
      expect(receivedParams).toEqual({ count: 5, name: "X" });
    });

    it("can simulate i18next bridge", () => {
      const mockI18next: Record<string, string> = {
        greeting: "Hello {{name}}",
        farewell: "Goodbye",
      };

      registerI1n((key, params) => {
        let value = mockI18next[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            value = value.replace(`{{${k}}}`, String(v));
          }
        }
        return value;
      });

      expect(t("greeting", { name: "Fran" })).toBe("Hello Fran");
      expect(t("farewell")).toBe("Goodbye");
      expect(t("unknown")).toBe("unknown");
    });

    it("clears engine with null and falls back to native", () => {
      registerI1n(() => "bridge");
      expect(t("greeting")).toBe("bridge");

      registerI1n(null);
      expect(t("greeting")).toBe("Native Hello");
    });
  });

  // ─── Interpolation Syntaxes ─────────────────────────────────────────
  describe("interpolation syntaxes", () => {
    beforeEach(() => {
      registerI1n(null);
      init({
        locale: "en_us",
        resources: {
          en_us: {
            curly: "Hello {name}",
            double_curly: "Hello {{name}}",
            percent: "Hello %{name}",
            mixed: "{a} and {{b}} and %{c}",
          },
        },
      });
    });

    it("replaces {var} syntax", () => {
      expect(t("curly", { name: "A" })).toBe("Hello A");
    });

    it("replaces {{var}} syntax", () => {
      expect(t("double_curly", { name: "B" })).toBe("Hello B");
    });

    it("replaces %{var} syntax", () => {
      expect(t("percent", { name: "C" })).toBe("Hello C");
    });

    it("replaces all 3 syntaxes in one string", () => {
      expect(t("mixed", { a: "1", b: "2", c: "3" })).toBe("1 and 2 and 3");
    });

    it("leaves unreplaced variables as-is", () => {
      expect(t("curly")).toBe("Hello {name}");
    });

    it("handles numeric variable values", () => {
      expect(t("curly", { name: 42 })).toBe("Hello 42");
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────
  describe("edge cases", () => {
    beforeEach(() => {
      registerI1n(null);
    });

    it("returns key when init not called with resources", () => {
      init({ locale: "", resources: {} });
      expect(t("anything")).toBe("anything");
    });

    it("handles re-initialization", () => {
      init({ locale: "en_us", resources: { en_us: { a: "first" } } });
      expect(t("a")).toBe("first");

      init({ locale: "en_us", resources: { en_us: { a: "second" } } });
      expect(t("a")).toBe("second");
    });

    it("handles deeply nested key with 4+ levels", () => {
      init({
        locale: "en_us",
        resources: { en_us: { a: { b: { c: { d: "deep" } } } } },
      });
      expect(t("a.b.c.d")).toBe("deep");
    });

    it("returns key when nested path hits a string before final part", () => {
      init({
        locale: "en_us",
        resources: { en_us: { a: { b: "string, not object" } } },
      });
      expect(t("a.b.c")).toBe("a.b.c");
    });
  });
});
