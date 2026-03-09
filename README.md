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

## 🛡️ Developer Experience

### 🔒 Privacy & Security

- **Auto-Ignore**: `i1n init` automatically adds sensitive config files to your `.gitignore`.
- **Secret Management**: API keys are only stored locally and never committed to version control.
- **Encrypted Transmission**: All sync operations happen over secure HTTPS channels.

### 🏷️ Type Safety

The CLI generates a lightweight declaration file that makes your translation keys type-safe:

```typescript
import { t } from "i1n";

// Full autocomplete & compile-time checking
t("common.greeting", { name: "Fran" });
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
