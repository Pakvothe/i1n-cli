import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { z } from "zod";

import { markAsMCPRuntime } from "../shared/supabase.js";
import { handleStatus } from "./tools/status.js";
import { handlePull } from "./tools/pull.js";
import { handlePush } from "./tools/push.js";
import { handleCheck } from "./tools/check.js";
import { handleTranslate } from "./tools/translate.js";
import { handleAddLanguage } from "./tools/add-language.js";
import { handleExtractAndTranslate } from "./tools/extract-and-translate.js";
import { handleSearch } from "./tools/search.js";
import { handleSetupBridge } from "./tools/setup-bridge.js";
import { getProjectResource } from "./resources/project.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "i1n",
    version: "1.0.0",
  });

  // --- Tools ---

  server.tool(
    "i1n_status",
    "Get project status including plan, limits, languages, and configuration",
    {},
    async () => handleStatus(),
  );

  server.tool(
    "i1n_pull",
    "Pull translations from i1n and generate TypeScript types",
    {},
    async () => handlePull(),
  );

  server.tool(
    "i1n_push",
    "Push local translation files to i1n (with diff detection, only changed keys are pushed)",
    {},
    async () => handlePush(),
  );

  server.tool(
    "i1n_check",
    "Validate local translation files offline: missing keys per language, broken interpolation placeholders, empty values, and coverage. Returns a JSON report. Safe for CI — no API calls.",
    {
      minCoverage: z.number().min(0).max(100).optional().describe("Fail (error-level issue) when overall translation coverage % is below this value"),
    },
    async (params) => handleCheck(params),
  );

  server.tool(
    "i1n_translate",
    "Translate to specified languages with AI. Estimates cost, translates, polls for completion, and auto-pulls results.",
    {
      languages: z.string().min(1).max(500).describe("Comma-separated target language codes (e.g. 'es,fr,de')"),
    },
    async (params) => handleTranslate(params),
  );

  server.tool(
    "i1n_add_language",
    "Add new languages to the project and optionally auto-translate existing keys",
    {
      languages: z.string().min(1).max(500).describe("Comma-separated language codes to add (e.g. 'es,fr,de')"),
      translate: z.boolean().optional().default(true).describe("Whether to auto-translate existing keys to the new languages (default: true)"),
    },
    async (params) => handleAddLanguage(params),
  );

  server.tool(
    "i1n_extract_and_translate",
    "Accept extracted strings, push them to i1n, translate to all active languages, and pull updated types. Pass an array of {key, value, namespace?} objects.",
    {
      strings: z.array(z.object({
        key: z.string().min(1).max(1000).describe("Translation key (e.g. 'common.greeting')"),
        value: z.string().min(1).max(50000).describe("Source language value (e.g. 'Hello, world!')"),
        namespace: z.string().max(200).optional().describe("Optional namespace (defaults to 'default')"),
      })).min(1).max(5000).describe("Array of strings to extract and translate"),
      languages: z.string().max(500).optional().describe("Optional comma-separated target language codes. If omitted, translates to all active languages."),
    },
    async (params) => handleExtractAndTranslate(params),
  );

  server.tool(
    "i1n_search",
    "Search existing translations by key name, namespace, or source value",
    {
      query: z.string().min(1).max(500).describe("Search query — matches against key, namespace, and source locale value"),
    },
    async (params) => handleSearch(params),
  );

  server.tool(
    "i1n_setup_bridge",
    "Detect any i18n library (i18next, vue-i18n, next-intl, react-intl, etc.) and configure i1n bridge mode in this project — end-to-end, with no terminal needed. Use when the user asks to 'set up / configure the bridge', 'wire up i1n with my existing i18n library', or 'install i1n on top of <library>'.\n\nIf `i1n.config.json` doesn't exist yet, pass `apiKey` (and optionally `projectId`) and the tool runs init non-interactively (validate, pick project, write config) before wiring the bridge. If `apiKey` is missing, the tool returns status `needs_api_key` so you can ask the user for it. If multiple projects exist, it returns status `multiple_projects` with the list — re-call with the chosen `projectId`.\n\nPass `write=true` to actually write the bridge helper file (do this whenever the user asks to *configure*/*install*; only leave it false if they explicitly asked to *analyze* or *preview*). For libraries outside the known list, the tool still emits a best-effort snippet flagged for verification.",
    {
      write: z.boolean().optional().describe("If true, writes the bridge helper file to disk (use this when the user asks to *configure*/install). Default: false."),
      bridgePath: z.string().min(1).max(500).optional().describe("Path for the bridge helper file. Default: 'src/i18n/i1n-bridge.ts' (or '.js' if no TypeScript detected)."),
      apiKey: z.string().min(1).max(200).optional().describe("i1n API key (format: i1n_<32 hex>). Required only when i1n.config.json doesn't exist yet — the tool will run init non-interactively. Ask the user for it the first time; do not invent one."),
      projectId: z.string().min(1).max(64).optional().describe("UUID of the i1n project to use during init. Only needed when the API key's organization has more than one project."),
      overwrite: z.boolean().optional().describe("If true, allow overwriting an existing file at bridgePath. Default: false (refuses to overwrite to avoid clobbering source files)."),
    },
    async (params) => handleSetupBridge(params),
  );

  // --- Resources ---

  server.resource(
    "project",
    "i1n://project",
    {
      description: "Ambient project configuration and status: config, plan, limits, active languages",
      mimeType: "application/json",
    },
    async (uri) => {
      const content = await getProjectResource();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: content,
          },
        ],
      };
    },
  );

  return server;
}

async function startMcpServer(): Promise<void> {
  // Tag every cli-sync request from this process as MCP-originated so
  // the dashboard's audit_logs differentiates MCP vs direct CLI usage.
  // MUST stay inside this action — registering at module load would
  // misattribute every plain `i1n` CLI invocation as MCP, because
  // `cli/index.ts` statically imports `mcpCommand` to register the
  // subcommand even when the user runs a non-MCP command.
  markAsMCPRuntime();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export const mcpCommand = new Command("mcp")
  .description("Start the i1n MCP server (Model Context Protocol)")
  .action(async () => {
    await startMcpServer();
  });
