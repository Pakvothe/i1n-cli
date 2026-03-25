import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { text, error } from "./helpers.js";

export async function handleSearch({ query }: { query: string }) {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  if (!query || query.trim().length === 0) {
    return error("No search query provided.");
  }

  const searchQuery = query.trim().toLowerCase();

  // Pull all wordings from backend
  let pullResult;
  try {
    pullResult = await callCliSync(
      "pull",
      { project_id: config.projectId },
      config.apiKey,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Failed to fetch translations");
  }

  const { wordings } = pullResult;

  if (wordings.length === 0) {
    return text("No translations found in this project.");
  }

  // Filter by query: case-insensitive match on key, namespace, or source locale value
  const matches = wordings.filter((w) => {
    if (w.key.toLowerCase().includes(searchQuery)) return true;
    if (w.namespace.toLowerCase().includes(searchQuery)) return true;
    const sourceValue = w.value_json[config.sourceLocale];
    if (sourceValue && sourceValue.toLowerCase().includes(searchQuery)) return true;
    return false;
  });

  if (matches.length === 0) {
    return text(`No translations found matching "${query}". Searched ${wordings.length} keys.`);
  }

  // Return top 20 matches
  const top = matches.slice(0, 20);

  const result = {
    query,
    total_matches: matches.length,
    showing: top.length,
    matches: top.map((w) => ({
      key: w.key,
      namespace: w.namespace,
      values: w.value_json,
    })),
  };

  return text(JSON.stringify(result, null, 2));
}
