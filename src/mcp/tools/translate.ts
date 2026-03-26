import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { executePull } from "../../cli/commands/pull.js";
import { text, error } from "./helpers.js";
import { waitForTranslation } from "./wait-for-translation.js";

export async function handleTranslate({ languages }: { languages: string }) {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  const targetLangs = languages
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  if (targetLangs.length === 0) {
    return error("No target languages specified. Provide a comma-separated list (e.g. 'es,fr,de').");
  }

  const messages: string[] = [];

  // Estimate translation cost
  let estimate;
  try {
    estimate = await callCliSync(
      "estimate-translate",
      {
        project_id: config.projectId,
        target_languages: targetLangs,
      },
      config.apiKey,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Could not estimate translation cost");
  }

  if (estimate.estimated_cost === 0) {
    return text("All translations are already up to date for the specified languages.");
  }

  messages.push(`Estimate: ${estimate.estimated_cost} WU (${estimate.cache_count} cached, ${estimate.ai_count} AI)`);
  messages.push(`Available credits: ${estimate.available_credits} / ${estimate.credits_limit} WU`);

  if (estimate.estimated_cost > estimate.available_credits) {
    return error(
      `Insufficient credits. Need ${estimate.estimated_cost} WU but only ${estimate.available_credits} available. Upgrade your plan.`,
    );
  }

  // Execute translation
  let translateResult;
  try {
    translateResult = await callCliSync(
      "translate",
      {
        project_id: config.projectId,
        target_languages: targetLangs,
      },
      config.apiKey,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Translation failed");
  }

  const cachedCount = Object.keys(translateResult.cached).length;
  if (cachedCount > 0) {
    messages.push(`${cachedCount} translations resolved from cache.`);
  }

  if (translateResult.queued > 0) {
    messages.push(`${translateResult.queued} items queued for AI translation. Waiting...`);

    const waitResult = await waitForTranslation(config.projectId, config.apiKey);

    if (waitResult.done) {
      messages.push("AI translation complete.");
    } else {
      messages.push(
        `Translation is still processing in the background (${waitResult.completed} completed so far). ` +
        `Use the i1n_pull tool in 2-3 minutes to fetch the completed translations.`,
      );
    }
  }

  if (translateResult.credits_used > 0) {
    messages.push(`Credits used: ${translateResult.credits_used} WU`);
  }

  // Auto-pull (even on timeout — will get whatever is done so far)
  try {
    const pullResult = await executePull(config);
    messages.push(
      `Pulled ${pullResult.wordings} keys across ${pullResult.languages} languages. TypeScript types updated.`,
    );
  } catch (err) {
    messages.push(
      `Warning: Auto-pull failed (${err instanceof Error ? err.message : "unknown error"}). Run \`i1n pull\` manually.`,
    );
  }

  return text(messages.join("\n"));
}
