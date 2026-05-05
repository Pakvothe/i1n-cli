import fs from "node:fs";
import path from "node:path";
import type { I1nProjectConfig, Format, TonePreset } from "./types.js";

export type AITool =
  | "claude"
  | "cursor"
  | "windsurf"
  | "copilot"
  | "codex"
  | "antigravity";

export const AI_TOOL_OPTIONS: {
  value: AITool;
  label: string;
  filePath: string;
}[] = [
  { value: "claude", label: "Claude Code", filePath: "CLAUDE.md" },
  { value: "cursor", label: "Cursor", filePath: ".cursor/rules/i1n.mdc" },
  { value: "windsurf", label: "Windsurf", filePath: ".windsurfrules" },
  {
    value: "copilot",
    label: "GitHub Copilot",
    filePath: ".github/copilot-instructions.md",
  },
  {
    value: "codex",
    label: "Codex (OpenAI / OpenCode)",
    filePath: "AGENTS.md",
  },
  {
    value: "antigravity",
    label: "Antigravity",
    filePath: ".antigravity/rules.md",
  },
];

const START_MARKER = "<!-- i1n:start -->";
const END_MARKER = "<!-- i1n:end -->";

const FORMAT_STRUCTURES: Record<Format, (localesDir: string) => string> = {
  "nested-json": (d) =>
    `\`${d}/{lang}/{namespace}.json\` — Nested JSON objects.\n` +
    "```json\n" +
    `// ${d}/en_us/common.json\n` +
    '{ "greeting": "Hello {name}", "errors": { "not_found": "Not found" } }\n' +
    "```",
  "flat-json": (d) =>
    `\`${d}/{lang}/{namespace}.json\` — Flat dot-notation keys.\n` +
    "```json\n" +
    `// ${d}/en_us/common.json\n` +
    '{ "greeting": "Hello {name}", "errors.not_found": "Not found" }\n' +
    "```",
  arb: (_d) =>
    "`lib/l10n/app_{lang}.arb` — Application Resource Bundle (Flutter).\n" +
    "```json\n" +
    '// lib/l10n/app_en.arb\n' +
    '{ "greeting": "Hello {name}", "@greeting": { "placeholders": { "name": {} } } }\n' +
    "```",
  yaml: (_d) =>
    "`config/locales/{lang}.yml` — YAML (Rails).\n" +
    "```yaml\n" +
    "# config/locales/en.yml\n" +
    "en:\n  greeting: Hello %{name}\n  errors:\n    not_found: Not found\n" +
    "```",
  "android-xml": (_d) =>
    "`res/values-{lang}/strings.xml` — Android XML resources.\n" +
    "```xml\n" +
    '<resources>\n  <string name="greeting">Hello %s</string>\n</resources>\n' +
    "```",
  "apple-strings": (_d) =>
    "`{lang}.lproj/Localizable.strings` — Apple Strings.\n" +
    "```\n" +
    '"greeting" = "Hello %@";\n' +
    "```",
  typescript: (d) =>
    `\`${d}/{lang}/{namespace}.ts\` — TypeScript modules.\n` +
    "```typescript\n" +
    `// ${d}/en_us/common.ts\n` +
    'export default { greeting: "Hello {name}" } as const;\n' +
    "```",
};

const TONE_LABELS: Record<Exclude<TonePreset, "custom">, string> = {
  formal: "Professional and formal. Write clearly and precisely. Avoid slang, contractions, and colloquialisms.",
  friendly: "Warm and approachable. Conversational but clear. Contractions are OK.",
  technical: "Precise and technical. Prioritize accuracy and domain-specific terminology. Be concise and unambiguous.",
  concise: "Extremely brief. Use the fewest words possible while preserving meaning. Omit filler words and pleasantries.",
};

export interface ToneSettings {
  tone_preset: TonePreset;
  brand_voice: string | null;
}

function getMcpInstallInstructions(tool?: AITool): string {
  switch (tool) {
    case "claude":
      return (
        "To install the i1n MCP server, run:\n" +
        "```\nclaude mcp add i1n -- npx i1n mcp\n```"
      );
    case "cursor":
      return (
        "To install the i1n MCP server, add to `.cursor/mcp.json`:\n" +
        "```json\n" +
        `{ "mcpServers": { "i1n": { "command": "npx", "args": ["i1n", "mcp"] } } }\n` +
        "```"
      );
    case "windsurf":
      return (
        "To install the i1n MCP server, add to your MCP config:\n" +
        "```json\n" +
        `{ "mcpServers": { "i1n": { "command": "npx", "args": ["i1n", "mcp"] } } }\n` +
        "```"
      );
    default:
      return (
        "To install the i1n MCP server (if your editor supports MCP):\n" +
        "```json\n" +
        `{ "mcpServers": { "i1n": { "command": "npx", "args": ["i1n", "mcp"] } } }\n` +
        "```"
      );
  }
}

export function generateI1nInstructions(config: I1nProjectConfig, tone?: ToneSettings, tool?: AITool): string {
  const structure =
    FORMAT_STRUCTURES[config.format]?.(config.localesDir) ??
    `\`${config.localesDir}/{lang}/{namespace}.json\``;

  const sections = [
    "# i1n — Localization as Code",
    "",
    "This project uses [i1n](https://i1n.ai) for managing translations.",
    "",
    "## Project Setup",
    `- **Format**: ${config.format}`,
    `- **Locales directory**: ${config.localesDir}`,
    `- **Source language**: ${config.sourceLocale}`,
    `- **Framework**: ${config.framework}`,
    "",
    "## Translation File Structure",
    structure,
    "",
  ];

  // Add tone/voice section if configured
  if (tone) {
    sections.push("## Tone & Voice");
    if (tone.tone_preset === "custom" && tone.brand_voice) {
      sections.push(`When writing or modifying translation values, follow these guidelines:`);
      sections.push(tone.brand_voice);
    } else if (tone.tone_preset !== "custom") {
      sections.push(`When writing or modifying translation values, use a **${tone.tone_preset}** tone.`);
      sections.push(TONE_LABELS[tone.tone_preset]);
    }
    sections.push("");
  }

  sections.push(
    "## MCP Server (Recommended)",
    "i1n has a native MCP server. If it's installed, **prefer using MCP tools over CLI commands** — they run directly in your IDE without switching to the terminal.",
    "",
    "To check if MCP is available, look for i1n tools like `i1n_push`, `i1n_pull`, `i1n_translate`, `i1n_setup_bridge` in your available tools.",
    "",
    "If MCP is not installed, recommend the user to set it up:",
    getMcpInstallInstructions(tool),
    "",
    "### MCP Tools",
    "- `i1n_push` — Push local translation files to i1n",
    "- `i1n_pull` — Pull translations and generate TypeScript types",
    "- `i1n_translate` — Translate keys to specified languages with AI",
    "- `i1n_extract_and_translate` — **Best tool for internationalization.** Pass extracted strings as `{key, value, namespace}` objects → i1n pushes them, translates to all active languages, and regenerates type definitions. Use this when the user asks to internationalize a component or file.",
    "- `i1n_search` — Search existing translation keys before creating new ones to avoid duplicates",
    "- `i1n_add_language` — Add new languages to the project",
    "- `i1n_status` — Check project status, plan, credits, and active languages",
    "- `i1n_setup_bridge` — Detect an existing i18n library (i18next, vue-i18n, next-intl, etc.) and wire up i1n bridge mode end-to-end. Use this when the user asks to *configure / set up the bridge* in their app, or to *install i1n on top of an existing i18n library*. Pass `write: true` to create the bridge helper file. If `i1n.config.json` doesn't exist yet, you can also pass `apiKey` (format `i1n_<32 hex>`, ask the user once) and optionally `projectId` — the tool will run init non-interactively (validate + write config) before wiring the bridge. If the tool returns status `needs_api_key`, ask the user for it; if it returns `multiple_projects`, present the list and re-call with the chosen `projectId`.",
    "",
    "### Workflow: Internationalizing a Component",
    "When asked to internationalize a file:",
    "1. Read the file and identify all hardcoded user-facing strings",
    "2. Use `i1n_search` to check if similar keys already exist",
    "3. Call `i1n_extract_and_translate` with the extracted strings",
    "4. Rewrite the component replacing hardcoded strings with translation keys, using whatever i18n method the project already uses (e.g., `t('key')`, `useTranslations()`, `intl.formatMessage()`, `i18next.t()`, or the i1n SDK)",
    "",
    "## CLI Commands",
    "If MCP is not available, use the CLI:",
    "- `i1n push` — Push local translation files to i1n. Supports `--translate [langs]` to trigger AI translation after push.",
    "- `i1n pull` — Pull translations from i1n and write local files. Also generates TypeScript type definitions (`i1n.d.ts`).",
    "- `i1n init` — Re-initialize or reconfigure i1n in this project.",
    "- `i1n setup-ai` — Regenerate AI assistant rules for this project.",
    "",
    "## Rules",
    "- Always use translation keys instead of hardcoded strings for user-facing text.",
    `- Place new keys in the appropriate namespace file under \`${config.localesDir}/\`.`,
    "- Never translate interpolation variables. Keep `{name}`, `{{name}}`, `%{name}`, etc. exactly as-is in every language. Match the variable syntax already used in the project.",
    "- After adding or modifying translation keys, run `i1n push` (or use `i1n_push` MCP tool) to sync changes.",
    "- Never modify `i1n.d.ts` directly — it is auto-generated by `i1n pull`.",
    "- Never commit `i1n.config.json` — it contains the API key and is gitignored.",
    "",
  );

  return sections.join("\n");
}

/**
 * Upserts i1n content into a file using markers.
 * If the file has existing markers, replaces the content between them.
 * If the file exists but has no markers, appends the section.
 * If the file doesn't exist, creates it with the section.
 */
function upsertSection(filePath: string, content: string): void {
  const section = `${START_MARKER}\n${content}${END_MARKER}`;

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (startIdx !== -1 && endIdx !== -1) {
      // Replace existing section
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + END_MARKER.length);
      fs.writeFileSync(filePath, before + section + after, "utf-8");
    } else {
      // Append section
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      fs.appendFileSync(filePath, `${separator}${section}\n`);
    }
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${section}\n`, "utf-8");
  }
}

/**
 * Writes AI config files for the selected tools.
 * Returns the list of file paths that were created/updated.
 */
export function writeAIConfigs(
  tools: AITool[],
  config: I1nProjectConfig,
  tone?: ToneSettings,
  cwd = process.cwd(),
): string[] {
  const written: string[] = [];

  for (const tool of tools) {
    const toolInfo = AI_TOOL_OPTIONS.find((t) => t.value === tool);
    if (!toolInfo) continue;

    // Generate per-tool instructions (MCP install steps differ by editor)
    const content = generateI1nInstructions(config, tone, tool);
    const filePath = path.join(cwd, toolInfo.filePath);

    if (tool === "cursor") {
      // Cursor uses a dedicated file per concern — overwrite entirely
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
    } else {
      // All others use the upsert/marker strategy
      upsertSection(filePath, content);
    }

    written.push(toolInfo.filePath);
  }

  return written;
}
