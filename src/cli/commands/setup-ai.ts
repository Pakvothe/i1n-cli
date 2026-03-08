import { Command } from "commander";
import * as p from "@clack/prompts";
import { readProjectConfig } from "../../shared/config.js";
import {
  type AITool,
  AI_TOOL_OPTIONS,
  writeAIConfigs,
} from "../../shared/ai-config.js";

export const setupAiCommand = new Command("setup-ai")
  .description("Generate AI assistant rules for your project")
  .action(async () => {
    const config = readProjectConfig();
    if (!config) {
      p.log.error("No i1n.config.json found. Run `i1n init` first.");
      process.exit(1);
    }

    p.intro("i1n setup-ai");

    const tools = await promptAITools();
    if (!tools) return;

    const written = writeAIConfigs(tools, config);

    for (const file of written) {
      p.log.success(`Created ${file}`);
    }

    p.outro(`${written.length} AI config file(s) generated.`);
  });

export async function promptAITools(): Promise<AITool[] | null> {
  const selected = await p.multiselect({
    message: "Which AI coding assistant(s) do you use?",
    options: [
      ...AI_TOOL_OPTIONS.map((t) => ({
        value: t.value,
        label: t.label,
      })),
      { value: "all" as const, label: "All of the above" },
    ],
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return null;
  }

  if (selected.includes("all" as AITool)) {
    return AI_TOOL_OPTIONS.map((t) => t.value);
  }

  return selected as AITool[];
}
