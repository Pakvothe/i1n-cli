# i1n

Localization as code. CLI and SDK for [i1n](https://i1n.ai) — push, pull, and translate your app's wordings from the terminal.

## Install

```bash
# CLI (global)
npm install -g i1n
pnpm add -g i1n
yarn global add i1n
bun add -g i1n

# SDK + types (project dependency)
npm install -D i1n
pnpm add -D i1n
yarn add -D i1n
bun add -D i1n
```

You can install it globally for terminal usage, as a dev dependency for CI/CD scripts and type-safe SDK access, or both.

## Quick Start

```bash
# 1. Set up your project (auth + auto-detect your i18n setup)
i1n init

# 2. Push local translations to i1n
i1n push

# 3. Pull translations back (generates type-safe definitions)
i1n pull
```

That's it. `init` detects your framework, format, and locale directory automatically. If auto-detection doesn't match your setup, you can configure it manually during init.

## Commands

### `i1n init`

Interactive setup that:

1. Authenticates with your API key (from the [i1n dashboard](https://i1n.ai))
2. Selects your project (if your organization has multiple)
3. Auto-detects your i18n framework, file format, locale directory, and source language
4. Saves config to `i1n.config.json` (auto-added to `.gitignore`)
5. Optionally sets up AI assistant rules for your coding tools

If detection doesn't match, you can configure everything manually — choose your locale directory, source language, and file format from the supported list.

### `i1n push`

Reads your local translation files and syncs them to i1n. New keys are created, existing keys are updated (merge, not overwrite).

After pushing, the CLI automatically checks for missing translations. If any are found, it shows a cost estimate and asks if you want to translate:

```
◇ 42 keys synced (5 created, 37 updated)
◇ Missing translations found
│  Available credits: 580 / 600 WU
│  Estimated cost: 13.4 WU
│    8 from cache @ 0.2 WU = 1.6 WU
│    12 via AI @ 1.0 WU = 12.0 WU
◆ Translate now? › Yes / No
```

Smart Translate checks the cache first — only cache misses are sent for AI translation, so you only pay for genuinely new translations.

```bash
# Push (will prompt to translate if missing translations are found)
i1n push

# Push and auto-translate without prompting
i1n push --translate

# Push and translate specific languages only
i1n push --translate es_es,fr_fr,pt_br
```

### `i1n pull`

Pulls translations from i1n and writes them to your locale files. Also generates a `i1n.d.ts` type definition file for type-safe usage with the SDK.

```bash
i1n pull
```

### `i1n setup-ai`

Generates AI assistant rules so your coding tool knows how to work with i1n in your project — translation file structure, CLI commands, and best practices.

```bash
i1n setup-ai
```

Supports:

| Tool | File generated |
| --- | --- |
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursor/rules/i1n.mdc` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Codex (OpenAI / OpenCode) | `AGENTS.md` |
| Antigravity | `.antigravity/rules.md` |

You can also set this up during `i1n init`. The generated content is specific to your project's format, locale directory, and framework.

## Supported Formats

| Format        | Framework                                         | File Structure                     |
| ------------- | ------------------------------------------------- | ---------------------------------- |
| Nested JSON   | i18next, next-intl, vue-i18n, expo, ngx-translate | `locales/{lang}/{namespace}.json`  |
| Flat JSON     | Generic                                           | `locales/{lang}/{namespace}.json`  |
| ARB           | Flutter                                           | `lib/l10n/app_{lang}.arb`          |
| YAML          | Rails                                             | `config/locales/{lang}.yml`        |
| Android XML   | Android                                           | `res/values-{lang}/strings.xml`    |
| Apple Strings | iOS                                               | `{lang}.lproj/Localizable.strings` |
| TypeScript    | Generic                                           | `locales/{lang}/{namespace}.ts`    |

The CLI auto-detects which format you're using based on your `package.json` dependencies, `pubspec.yaml`, `Gemfile`, or filesystem structure. You can also set it manually.

## SDK (optional)

The CLI works on its own — you don't need the SDK. But if you want a type-safe `t()` function in your app, the same package exports a lightweight runtime:

```typescript
import { init, t } from "i1n";

init({
  locale: "en_us",
  translations: {
    common: {
      greeting: "Hello {name}",
      title: "My App",
    },
  },
});

t("common.title"); // "My App"
t("common.greeting", { name: "World" }); // "Hello World"
```

### Type Safety

After running `i1n pull`, a `i1n.d.ts` file is generated in your locale directory. This gives you full autocomplete and type checking on translation keys and their variables:

```typescript
// Auto-generated — do not edit
declare module "i1n" {
  interface I1nKeys {
    "common.title": Record<string, never>;
    "common.greeting": { name: string };
  }

  type I1nKey = keyof I1nKeys;

  function t<K extends I1nKey>(
    key: K,
    ...args: I1nKeys[K] extends Record<string, never>
      ? []
      : [variables: I1nKeys[K]]
  ): string;
}
```

Keys without variables require no second argument. Keys with variables require a typed object — all enforced at compile time.

### Variable Syntax

Three variable syntaxes are supported in your translation values:

```
Hello {name}        →  Standard
Hello {{name}}      →  Handlebars-style
Hello %{name}       →  Ruby/Rails-style
```

All three are detected and replaced automatically. Use whichever matches your existing setup.

## Configuration

### `i1n.config.json`

Created by `i1n init` in your project root. Contains your API key and project settings:

```json
{
  "apiKey": "i1n_...",
  "projectId": "your-project-uuid",
  "localesDir": "locales",
  "sourceLocale": "en_us",
  "format": "nested-json",
  "framework": "i18next"
}
```

This file is automatically added to `.gitignore` during `i1n init` because it contains your API key. Each project has its own config — if you work on multiple projects, each one has its own `i1n.config.json` with its own API key.

## Credits & Billing

i1n uses **Wording Units (WU)** for translation billing:

- **AI translation**: 1.0 WU per item (flat rate)
- **Cache hit**: 0.01–0.2 WU per item (depends on your plan)

The `i1n push` command shows your available credits and estimated cost before translating. Credits refill automatically based on your plan cycle (weekly for Starter, monthly for paid plans).

## Error Handling

The CLI gives explicit feedback when something goes wrong:

- **Corrupt files** — warns you with the file path and error, continues processing valid files
- **Invalid format** — tells you which file failed and why
- **Missing directory** — tells you to check your `localesDir` config
- **No keys found** — suggests checking your format setting
- **Insufficient credits** — warns you before translating

Warnings are never silently ignored.

## License

MIT — see [LICENSE](LICENSE) for details.
