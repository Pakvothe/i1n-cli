import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { z } from "zod";

import { handleStatus } from "./tools/status.js";
import { handlePull } from "./tools/pull.js";
import { handlePush } from "./tools/push.js";
import { handleTranslate } from "./tools/translate.js";
import { handleAddLanguage } from "./tools/add-language.js";
import { handleExtractAndTranslate } from "./tools/extract-and-translate.js";
import { handleSearch } from "./tools/search.js";
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
    "i1n_translate",
    "Translate to specified languages with AI. Estimates cost, translates, polls for completion, and auto-pulls results.",
    {
      languages: z.string().describe("Comma-separated target language codes (e.g. 'es,fr,de')"),
    },
    async (params) => handleTranslate(params),
  );

  server.tool(
    "i1n_add_language",
    "Add new languages to the project and optionally auto-translate existing keys",
    {
      languages: z.string().describe("Comma-separated language codes to add (e.g. 'es,fr,de')"),
      translate: z.boolean().optional().default(true).describe("Whether to auto-translate existing keys to the new languages (default: true)"),
    },
    async (params) => handleAddLanguage(params),
  );

  server.tool(
    "i1n_extract_and_translate",
    "Accept extracted strings, push them to i1n, translate to all active languages, and pull updated types. Pass an array of {key, value, namespace?} objects.",
    {
      strings: z.array(z.object({
        key: z.string().describe("Translation key (e.g. 'common.greeting')"),
        value: z.string().describe("Source language value (e.g. 'Hello, world!')"),
        namespace: z.string().optional().describe("Optional namespace (defaults to 'default')"),
      })).describe("Array of strings to extract and translate"),
      languages: z.string().optional().describe("Optional comma-separated target language codes. If omitted, translates to all active languages."),
    },
    async (params) => handleExtractAndTranslate(params),
  );

  server.tool(
    "i1n_search",
    "Search existing translations by key name, namespace, or source value",
    {
      query: z.string().describe("Search query — matches against key, namespace, and source locale value"),
    },
    async (params) => handleSearch(params),
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
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export const mcpCommand = new Command("mcp")
  .description("Start the i1n MCP server (Model Context Protocol)")
  .action(async () => {
    await startMcpServer();
  });
