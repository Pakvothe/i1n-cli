# i1n 💎

**Localization as code.** The modern architecture to localize apps at the speed of thought.

[i1n](https://i1n.ai) bridges the gap between Developers, AI Agents, and Product Teams, making localization a native part of your development workflow rather than a chore.

---

## 🏛️ The i1n Philosophy

i1n is built on three core pillars designed to make localization extremely fast, efficient, and low-maintenance:

### 🚀 Dev-First

Zero-friction integration with your existing codebase. i1n lives in your terminal and your IDE, providing native type-safety and automated workflows that eliminate manual JSON editing.

### 🤖 AI-Native

Built for the age of AI. i1n provides smart orchestration and context rules that turn your AI agents (Cursor, Claude, Copilot, etc.) into localization experts who understand your project's specific conventions and tone.

### ⚡ Team-Sync

A seamless bridge between Developers, AI Agents, and Product Teams. Localize features as you build them, with zero maintenance overhead and real-time synchronization.

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

# 2. Sync local wordings to the cloud
i1n push

# 3. Pull translations & generate types
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
- Uses `WU` (Wording Units) efficiently with a robust caching layer.

### ⬇️ `i1n pull`

**Downloads translations and generates type-safe IDs.**

- Updates local locale files in your configured format.
- Generates `i1n.d.ts` for full IDE autocomplete.

### 📊 `i1n limits`

**Real-time usage tracking.**

- View your current plan and wording/credit usage.
- Monitor active language slots and available capacity.

### 🧠 `i1n setup-ai`

**Turns your IDE into a localization expert.**

- Generates project-specific rules for **Cursor (`.mdc`)**, **Claude Code (`CLAUDE.md`)**, **Windsurf**, and more.
- Ensures AI agents follow your naming conventions, file structure, and brand voice.

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

// Load your translation resources (from i1n pull output or your own files)
init({
  locale: "en_us",
  resources: {
    en_us: {
      common: { greeting: "Hello {name}", farewell: "Goodbye" },
      items_one: "One item",
      items_other: "{count} items",
    },
    es_es: {
      common: { greeting: "Hola {name}", farewell: "Adiós" },
      items_one: "Un elemento",
      items_other: "{count} elementos",
    },
  },
});

t("common.greeting", { name: "World" }); // "Hello World"
t("items", { count: 5 }); // "5 items"

// Switch language at runtime
setLocale("es_es");
t("common.greeting", { name: "World" }); // "Hola World"
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
import { createContext, useContext, useState } from "react";
import { init, t, getLocale, setLocale as sdkSetLocale } from "i1n";

// 1. Initialize with wordings
init({
  locale: "en_us",
  resources: { en: { ... }, es: { ... } }
});

const I1nContext = createContext({ locale: "en_us" });

// 2. Simple Provider & Hook
export function I1nProvider({ children }) {
  const [locale, setLocaleState] = useState(getLocale());

  const setLocale = (newLocale: string) => {
    sdkSetLocale(newLocale);
    setLocaleState(newLocale);
  };

  return (
    <I1nContext.Provider value={{ locale, setLocale }}>
      {children}
    </I1nContext.Provider>
  );
}

export const useI1n = () => ({ t, ...useContext(I1nContext) });
```

Usage:

```tsx
const { t, setLocale } = useI1n();
return <button onClick={() => setLocale("es_es")}>{t("auth.title")}</button>;
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

1. **Pull**: Run `i1n pull`. The CLI automatically generates `locales/i1n.d.ts` and updates your `tsconfig.json` or `jsconfig.json`.
2. **Usage**: Import `t` from `i1n` and get full autocomplete + compile-time checking.

```typescript
import { t } from "i1n";

// Full autocomplete & compile-time checking
t("auth.login.title");

// ERROR: Argument of type '"auth.login.titlse"' is not assignable...
t("auth.login.titlse");
```

---

## 💳 Credits & Billing

i1n uses **Wording Units (WU)** for fair billing:

- **AI Translation**: 1.0 WU per item.
- **Smart Cache**: Only 0.01–0.2 WU per hit.
- **Refills**: Credits refill automatically based on your plan cycle.

---

## 📄 License

MIT — © 2026 i1n.ai
