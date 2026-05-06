# i1n

**Your app in every language. One command.**

[![npm](https://img.shields.io/npm/v/i1n)](https://www.npmjs.com/package/i1n) [![license](https://img.shields.io/npm/l/i1n)](https://github.com/Pakvothe/i1n-cli/blob/main/LICENSE) [![MCP](https://img.shields.io/badge/MCP-7_tools-amber)](https://i1n.ai)

![demo](./demo.gif)

Localization as code. Push your translation keys, AI translates to 182 languages, pull type-safe TypeScript definitions. Built for developers, AI agents, and product teams.

**Free forever** · No credit card · [i1n.ai](https://i1n.ai)

---

## Why i1n?

Traditional i18n means dozens of JSON files, zero type safety, hours of copy-pasting, and deploys that break at 2 AM. Existing tools charge $120+/mo and require browser-based workflows.

i1n is different:

- **One command** — `i1n push --translate es,fr,ja` and you're done
- **Type-safe** — auto-generated `i1n.d.ts` with full IDE autocomplete
- **AI-native** — MCP server for Cursor, Claude Code, Windsurf. Your agent handles i18n for you
- **Zero migration** — Bridge Mode wraps your existing i18next/next-intl/vue-i18n
- **6x cheaper** — Free tier included. Pro at $19/mo vs Lokalise at $120/mo

---

## 📦 Install

```bash
# To use the CLI (global)
npm install -g i1n

# To use the SDK + types (in your app)
npm install i1n

# Local CLI usage (optional)
npm install -D i1n
```

_Supports `npm`, `pnpm`, `yarn`, and `bun`._

---

## 🏁 Quick Start

```bash
# 1. Initialize (auth + auto-detect setup)
i1n init

# 2. Push your translation keys
i1n push

# 3. Pull translations + auto-generated TypeScript types
i1n pull
```

---

## ✨ Key Features & Commands

### 🛠️ `i1n init`

**Interactive setup that prepares your workspace.**

- Authenticates via API key.
- **New?** If you don't have a key yet, the CLI provides clear guidance on how to get started.
- Auto-detects frameworks (Next.js, Vite, Expo, Flutter, Rails, etc.).
- Saves configuration to `i1n.config.json` (automatically ignored via `.gitignore`).
- **AI Orchestration**: Optionally sets up rules for your AI coding tools.

### ⬆️ `i1n push`

**Syncs your local translations to i1n.**

- Detects new keys and source changes.
- **Smart Translate**: Offers to translate missing keys with a cost estimate before proceeding.
- Efficient caching layer — repeated translations cost a fraction of fresh ones.

### ⬇️ `i1n pull`

**Downloads translations and generates type-safe IDs.**

- Updates local locale files in your configured format.
- Generates `i1n.d.ts` for full IDE autocomplete.

### 📊 `i1n limits`

**Real-time usage tracking.**

- View your current plan and credit usage.
- Monitor active language slots and available capacity.

### 🧠 `i1n setup-ai`

**Turns your IDE into a localization expert.**

- Generates project-specific rules for **Cursor (`.mdc`)**, **Claude Code (`CLAUDE.md`)**, **Windsurf**, and more.
- Ensures AI agents follow your naming conventions, file structure, and brand voice.

### 🔌 `i1n mcp`

**MCP server for AI coding assistants.**

Starts a [Model Context Protocol](https://modelcontextprotocol.io) server that lets Cursor, Claude Code, Windsurf, and other AI assistants execute i1n commands directly from your IDE.

```bash
# Add to Claude Code
claude mcp add i1n -- npx i1n mcp

# Or add to .mcp.json / cursor config
```

```json
{
  "mcpServers": {
    "i1n": {
      "command": "npx",
      "args": ["i1n", "mcp"]
    }
  }
}
```

**7 tools available:**

| Tool | Description |
| ---- | ----------- |
| `i1n_status` | Get project status, plan, limits, and active languages |
| `i1n_push` | Push local translation files with automatic diff detection |
| `i1n_pull` | Pull translations and generate type-safe TypeScript definitions |
| `i1n_translate` | Translate keys to specified languages using AI |
| `i1n_add_language` | Add new languages with optional auto-translation |
| `i1n_extract_and_translate` | Extract strings from code, push as keys, translate to all languages |
| `i1n_search` | Search existing translation keys by name or value |

**The killer workflow** — tell your AI agent "internationalize this component":

1. The agent reads your file and identifies hardcoded strings
2. It calls `i1n_extract_and_translate` with the extracted strings
3. i1n pushes the keys, translates to all active languages, generates types
4. The agent rewrites your component with `t('key')` calls

A 60-minute task in 30 seconds.

---

## 📁 Supported Formats

| Format            | Frameworks                   | File Sample           |
| ----------------- | ---------------------------- | --------------------- |
| **Nested JSON**   | i18next, next-intl, vue-i18n | `en/common.json`      |
| **Flat JSON**     | React Native, Generic        | `locales/en.json`     |
| **ARB**           | Flutter / Dart               | `app_en.arb`          |
| **YAML**          | Ruby on Rails                | `en.yml`              |
| **Android XML**   | Native Android               | `strings.xml`         |
| **Apple Strings** | iOS / macOS                  | `Localizable.strings` |
| **TypeScript**    | Type-safe JSON               | `locales/en.ts`       |

---

## 🧩 SDK Usage

The `i1n` package includes a runtime SDK for web and mobile JS/TS projects. You can use it in two ways:

### Standalone Mode — Replace your i18n library

Use the i1n native engine directly. No external dependencies needed.

```typescript
import { init, t, setLocale } from "i1n";

// Load your translation resources
init({
  locale: "en_us",
  resources: {
    en_us: {
      auth: { login: "Login", title: "Welcome back, {user}" },
      items_one: "One item",
      items_other: "{count} items",
    },
    es_es: {
      auth: { login: "Entrar", title: "Bienvenido de nuevo, {user}" },
      items_one: "Un elemento",
      items_other: "{count} elementos",
    },
  },
});

// Autocomplete and type-safety work out of the box after 'i1n pull'
t("auth.login"); // "Login"

// Support for default values (useful during development)
t("new.key", { defaultValue: "Coming soon..." }); // "Coming soon..."

// Variables & Plurals
t("auth.title", { user: "Fran" }); // "Welcome back, Fran"
t("items", { count: 5 }); // "5 items"

// Switch language at runtime
setLocale("es_es");
t("auth.login"); // "Entrar"
```

**Key resolution** works with both nested and flat structures automatically — use whatever format your project prefers.

### Bridge Mode — Keep your library, add type safety

Already using i18next, vue-i18n, or react-intl? Connect it to i1n with one line and get full autocompletion.

```typescript
import i18next from "i18next";
import { registerI1n, t } from "i1n";

// Set up i18next as usual
await i18next.init({
  lng: "en",
  resources: {
    /* ... */
  },
});

// Connect to i1n — one line
registerI1n((key, params) => i18next.t(key, params));

// Now t() uses i18next under the hood, but with strict type checking
t("common.greeting", { name: "World" }); // Powered by i18next, typed by i1n
```

Works with any library:

- **vue-i18n**: `registerI1n((key, params) => i18n.global.t(key, params))`
- **react-intl**: `registerI1n((key, params) => intl.formatMessage({ id: key }, params))`
- **Custom**: `registerI1n((key) => myLookup(key))`

### Pluralization

Define plural variants with `_zero`, `_one`, `_other` suffixes:

```typescript
// In your translation files:
// "items_zero": "No items"
// "items_one": "One item"
// "items_other": "{count} items"

t("items", { count: 0 }); // "No items"
t("items", { count: 1 }); // "One item"
t("items", { count: 5 }); // "5 items"
```

### Interpolation

Three syntaxes supported universally: `{var}`, `{{var}}`, `%{var}`

### JavaScript (without TypeScript)

The SDK works in plain JS — you just don't get autocompletion:

```javascript
import { init, t } from "i1n";
init({ locale: "en_us", resources: { en_us: { greeting: "Hello {name}" } } });
t("greeting", { name: "World" }); // "Hello World"
```

### ⚛️ React / Preact Integration

For a "plug and play" experience, use this minimalist provider pattern.

```tsx
import { createContext, useContext, useState, useEffect } from "react";
import { init, t, getLocale, setLocale as sdkSetLocale } from "i1n";

// 1. Initialize with wordings
// (In a real app, you'd probably import these from your locales folder)
init({
  locale: "en_us",
  resources: {
    /* ... */
  },
});

const STORAGE_KEY = "i1n-locale";
const I1nContext = createContext({
  locale: "en_us",
  setLocale: (l: string) => {},
});

// 2. Persistent Provider
export function I1nProvider({ children, defaultLocale = "en_us" }) {
  const [locale, setLocaleState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || defaultLocale;
  });

  // Keep SDK in sync
  useEffect(() => {
    sdkSetLocale(locale);
  }, [locale]);

  const setLocale = (newLocale: string) => {
    localStorage.setItem(STORAGE_KEY, newLocale);
    setLocaleState(newLocale);
  };

  return (
    <I1nContext.Provider value={{ locale, setLocale }}>
      {children}
    </I1nContext.Provider>
  );
}

// 3. Simple Hook
export const useI1n = () => ({ t, ...useContext(I1nContext) });
```

Usage:

```tsx
const { t, setLocale } = useI1n();

return (
  <div>
    <h1>{t("auth.title", { user: "Fran" })}</h1>
    <button onClick={() => setLocale("es_es")}>Español</button>
  </div>
);
```

### Non-JS Platforms

Flutter, Android, and iOS projects don't use the SDK. They use the translation files (`.arb`, `.xml`, `.strings`) generated by `i1n pull` with their native localization systems.

---

## 🛡️ Developer Experience

### 🔒 Privacy & Security

- **Auto-Ignore**: `i1n init` automatically adds sensitive config files to your `.gitignore`.
- **Secret Management**: API keys are only stored locally and never committed to version control.
- **Encrypted Transmission**: All sync operations happen over secure HTTPS channels.

### 🔒 Zero-Config Type Safety (TypeScript)

The CLI generates a lightweight declaration file (`i1n.d.ts`) that automatically augments the `i1n` package with your project's specific keys.

1. **Pull**: Run `i1n pull`. The CLI generates `locales/i1n.d.ts` and **automatically updates** your `tsconfig.json` so your IDE finds them immediately.
2. **Usage**: Import `t` from `i1n` and get full autocomplete + compile-time checking. No manual path mapping required.

```typescript
import { t } from "i1n";

// Full autocomplete & compile-time checking
t("auth.login.title");

// ERROR: Argument of type '"auth.login.titlse"' is not assignable...
t("auth.login.titlse");

// Dynamic strings still pass through — useful for `t(item.name)`,
// runtime-built keys, etc.
declare const dynamicKey: string;
t(dynamicKey);
```

> Strict literal checking landed in `1.3.0`: passing a hard-coded string that
> isn't in `I1nKeys` is now a TypeScript error (no more silent
> `[i1n] Missing translation` warnings at runtime). Variables typed as
> `string` keep working without casts.

---

## 💳 Pricing

| Plan | Price | Keys | Languages | AI translations/mo |
|------|-------|------|-----------|--------------------|
| **Starter** | $0 | 600 | 2 | 2,000 |
| **Pro** | $19/mo | 5,000 | 5 | 10,000 |
| **Business** | $49/mo | 15,000 | 12 | 20,000 |
| **Enterprise** | Custom | Custom | 182 | Custom |

CLI, SDK, and MCP server are free on every plan. No credit card required for Starter.

Pro lifetime from $99 — [only for the first 200 users](https://i1n.ai/pricing).

---

## 📄 License

MIT — © 2026 i1n.ai
