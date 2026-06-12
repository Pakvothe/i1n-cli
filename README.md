# i1n

**Your app in every language. One command.**

[![npm](https://img.shields.io/npm/v/i1n)](https://www.npmjs.com/package/i1n) [![license](https://img.shields.io/npm/l/i1n)](https://github.com/Pakvothe/i1n-cli/blob/main/LICENSE) [![MCP](https://img.shields.io/badge/MCP-8_tools-amber)](https://i1n.ai) [![Listed on MCP Servers](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/pakvothe/i1n-cli) [![Security: DeepSec](https://img.shields.io/badge/security-DeepSec_audited-success)](https://github.com/vercel-labs/deepsec)

![demo](./demo.gif)

Localization as code. Push your translation keys, AI translates to 182 languages, pull type-safe TypeScript definitions. Built for developers, AI agents, and product teams.

**Free forever** · No credit card · [i1n.ai](https://i1n.ai)

---

## Why i1n?

Traditional i18n means dozens of JSON files, zero type safety, hours of copy-pasting, and deploys that break at 2 AM. Existing tools charge $144+/mo and require browser-based workflows.

i1n is different:

- **One command** — `i1n push --translate es,fr,ja` and you're done
- **Type-safe** — auto-generated `i1n.d.ts` with full IDE autocomplete
- **AI-native** — MCP server for Cursor, Claude Code, Windsurf. Your agent handles i18n for you
- **Zero migration** — Bridge Mode wraps your existing i18next/next-intl/vue-i18n
- **5x cheaper** — Free tier included. Pro at $29/mo vs Lokalise at $144/mo

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
- **Three-way diff** — push only sends the (key, lang) pairs you actually changed, never overwriting edits made via the dashboard or by other teammates. See [Team workflow](#-team-workflow) for the full conflict model.

**Flags:**

- `--translate [langs]` — trigger AI translation after push (e.g. `--translate es,fr,ja`)
- `--strategy <mode>` — how to handle real conflicts: `interactive` (default in TTY), `ours`, `theirs`, `abort`
- `--force` — shorthand for `--strategy ours` (overwrite the server with your local values; destructive)

### ⬇️ `i1n pull`

**Downloads translations and generates type-safe IDs.**

- Updates local locale files in your configured format.
- Generates `i1n.d.ts` for full IDE autocomplete.

### 📊 `i1n limits`

**Real-time usage tracking.**

- View your current plan and credit usage.
- Monitor active language slots and available capacity.

### ✅ `i1n check`

**Catch broken translations before they ship. Built for CI.**

- Detects missing keys per language, **broken interpolation placeholders** (`{{count}}` lost in translation), empty values, and malformed files.
- `--min-coverage 95` fails the build when translation coverage drops below your threshold.
- `--json` for tooling. Exit codes: `0` clean, `1` errors found, `2` config problem.
- 100% offline — no API calls, no secrets needed in CI.

```yaml
# .github/workflows/ci.yml
- name: Validate translations
  run: npx i1n check --min-coverage 95
```

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

**8 tools available:**

| Tool | Description |
| ---- | ----------- |
| `i1n_status` | Get project status, plan, limits, and active languages |
| `i1n_push` | Push local translation files with three-way diff (preserves server-side edits, aborts on conflict so the agent can resolve) |
| `i1n_pull` | Pull translations and generate type-safe TypeScript definitions |
| `i1n_translate` | Translate keys to specified languages using AI |
| `i1n_add_language` | Add new languages with optional auto-translation |
| `i1n_extract_and_translate` | Extract strings from code, push as keys, translate to all languages |
| `i1n_search` | Search existing translation keys by name or value |
| `i1n_setup_bridge` | Detect your i18n library (i18next, vue-i18n, next-intl, etc.) and wire up i1n bridge mode end-to-end |

**The killer workflow** — tell your AI agent "internationalize this component":

1. The agent reads your file and identifies hardcoded strings
2. It calls `i1n_extract_and_translate` with the extracted strings
3. i1n pushes the keys, translates to all active languages, generates types
4. The agent rewrites your component with `t('key')` calls

A 60-minute task in 30 seconds.

---

## 👥 Team workflow

i1n is designed for teams where multiple people edit translations in parallel — devs in different branches, copywriters in the dashboard, AI agents via MCP. `i1n push` is safe to run without worrying that your local working tree might pulverize someone else's edits.

### How push decides what to send

Before every push, the CLI:

1. Reads your local locale files (`L`).
2. Asks the server which keys exist and when each was last modified (cheap metadata-only call, ~50× smaller than a full pull).
3. If anything moved on the server since your last sync, fetches the full server state (`S`).
4. Computes a three-way diff per `(namespace, key, lang)` against the last baseline you synced (`P`, stored in `locales/.i1n-push-state.json`).

For each `(key, lang)` the diff places it in one of these buckets:

| Local | Server | Baseline | Action |
| --- | --- | --- | --- |
| `==` server | — | — | unchanged, skip |
| `==` baseline | changed | — | **server-only** — auto-pull into your locale files |
| changed | `==` baseline | — | **local edit** — push it |
| changed | changed | both moved | **conflict** — resolve interactively |
| missing | present | present in baseline | warn, don't propagate (no delete verb) |

Only the languages that genuinely changed locally are sent. Languages you didn't touch are not in the payload, so the server's per-language merge preserves them. No more "my push silently overwrote yield_rate that I never even opened".

### When there's a real conflict

A real conflict means **you and someone else both edited the same `(key, lang)` to different values** since the last sync. The CLI shows each one and asks you to pick:

```
Conflict 1/3: common.greeting [en_us]

  › Keep local: "Hello there"
    Accept server: "Hi"
    Abort push
```

- **Local** → push your value, overwrite the server.
- **Server** → discard your local, auto-pull the server's value into your file.
- **Abort** → exit; nothing is pushed.

For batch / CI / non-interactive environments, pass a strategy:

```bash
i1n push --strategy theirs   # accept all server values, push nothing for conflicts
i1n push --strategy ours     # local wins (alias: --force)
i1n push --strategy abort    # exit on any conflict
```

In non-TTY contexts (e.g. CI without a strategy flag), push aborts with a diff of the conflicts so you can resolve in code.

### Auto-pulling server-only changes

If a teammate or someone in the dashboard updated a key you never touched, the server's value is automatically written into your local file at push time and your `i1n.d.ts` is regenerated if needed. Your working tree ends up reflecting reality — your `git diff` will show the bring-in so you can commit it alongside your own changes.

### MCP push (AI agents)

The MCP `i1n_push` tool runs the same diff but defaults to **abort on conflict** because an AI agent should not silently pick a winner. Conflicts are reported in the response so the agent can decide to pull, ask you, or resolve manually before retrying.

### Fresh checkouts

`locales/.i1n-push-state.json` is gitignored by design — it's working-tree state, like `.git/index`. On a fresh clone or new branch where the file doesn't exist, the baseline is synthesized from the server. Any local divergence from the server is then treated as a conflict (the CLI can't tell whether you edited locally or have stale data). Run `i1n pull` first if you just cloned and want to bring everything in cleanly.

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

| Plan | Price | Keys (shared pool) | Languages | AI translations/mo |
|------|-------|--------------------|-----------|--------------------|
| **Starter** | $0 | 200 | 2 | 2,000 |
| **Pro** | $29/mo | 2,000 | 3 | 10,000 |
| **Business** | $99/mo | 8,000 | 6 | 30,000 |
| **Enterprise** | From $399/mo | Custom (25k+) | Unlimited | Custom |

CLI, SDK, and MCP server are free on every plan. No credit card required for Starter.

Pro lifetime from $199 — [only for the first 200 users](https://i1n.ai/pricing).

---

## 📄 License

MIT — © 2026 i1n.ai
