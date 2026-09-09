import { readProjectConfig } from "../../shared/config.js";
import { executePull } from "../../cli/commands/pull.js";
import { text, error } from "./helpers.js";

export async function handlePull() {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  try {
    const result = await executePull(config);

    if (result.wordings === 0) {
      return text("No translations found in this project. Add translations in the dashboard first, then pull again.");
    }

    return text(
      `Pull complete: ${result.wordings} keys across ${result.languages} languages written. TypeScript types generated.`,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Pull failed");
  }
}
