import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { executePull } from "../../cli/commands/pull.js";
import { text, error } from "./helpers.js";
import { waitForTranslation } from "./wait-for-translation.js";
import type { Wording } from "../../shared/types.js";

export async function handleExtractAndTranslate({
  strings,
  languages,
}: {
  strings: Array<{ key: string; value: string; namespace?: string }>;
  languages?: string;
}) {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  if (!strings || strings.length === 0) {
    return error("No strings provided. Pass an array of {key, value, namespace?} objects.");
  }

  const messages: string[] = [];

  // Convert strings to Wording[] format
  const wordings: Wording[] = strings.map((s) => ({
    key: s.key,
    namespace: s.namespace ?? "default",
    value_json: { [config.sourceLocale]: s.value },
  }));

  // Push the wordings
  let totalCreated = 0;
  let totalUpdated = 0;
  const BATCH_SIZE = 500;

  try {
    for (let i = 0; i < wordings.length; i += BATCH_SIZE) {
      const batch = wordings.slice(i, i + BATCH_SIZE);
      const result = await callCliSync(
        "push",
        { project_id: config.projectId, wordings: batch },
        config.apiKey,
      );
      totalCreated += result.created;
      totalUpdated += result.updated;
      if (result.warning) {
        messages.push(`Warning: ${result.warning}`);
      }
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : "Push failed");
  }

  messages.push(`Pushed ${wordings.length} keys (${totalCreated} created, ${totalUpdated} updated).`);

  // Determine target languages
  let targetLangs: string[] | undefined;
  if (languages) {
    targetLangs = languages
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  // Estimate translation
  let estimate;
  try {
    estimate = await callCliSync(
      "estimate-translate",
      {
        project_id: config.projectId,
        ...(targetLangs && { target_languages: targetLangs }),
      },
      config.apiKey,
    );
  } catch (err) {
    messages.push(`Warning: Could not estimate translation (${err instanceof Error ? err.message : "unknown error"}).`);
    messages.push("Keys were pushed successfully. Run `i1n push --translate` to translate later.");
    return text(messages.join("\n"));
  }

  if (estimate.estimated_cost === 0) {
    messages.push("All translations are already up to date.");
    try {
      const pullResult = await executePull(config);
      messages.push(
        `Pulled ${pullResult.wordings} keys across ${pullResult.languages} languages. TypeScript types updated.`,
      );
    } catch {
      messages.push("Warning: Auto-pull failed. Run `i1n pull` manually.");
    }

    messages.push("");
    messages.push("You can now use these keys in your code:");
    for (const s of strings.slice(0, 10)) {
      messages.push(`  t('${s.namespace && s.namespace !== "default" ? s.namespace + ":" : ""}${s.key}')`);
    }
    if (strings.length > 10) {
      messages.push(`  ... and ${strings.length - 10} more`);
    }

    return text(messages.join("\n"));
  }

  messages.push(`Translation estimate: ${estimate.estimated_cost} WU (${estimate.cache_count} cached, ${estimate.ai_count} AI)`);

  if (estimate.estimated_cost > estimate.available_credits) {
    messages.push(
      `Warning: Insufficient credits (need ${estimate.estimated_cost}, have ${estimate.available_credits}). ` +
        `Keys were pushed but translation was skipped. Upgrade your plan.`,
    );
    return text(messages.join("\n"));
  }

  // Execute translation
  try {
    const translateResult = await callCliSync(
      "translate",
      {
        project_id: config.projectId,
        ...(targetLangs && { target_languages: targetLangs }),
      },
      config.apiKey,
    );

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
  } catch (err) {
    messages.push(`Warning: Translation failed (${err instanceof Error ? err.message : "unknown error"}).`);
    messages.push("Keys were pushed successfully. Run `i1n push --translate` to translate later.");
    return text(messages.join("\n"));
  }

  // Auto-pull
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

  messages.push("");
  messages.push("You can now use these keys in your code:");
  for (const s of strings.slice(0, 10)) {
    messages.push(`  t('${s.namespace && s.namespace !== "default" ? s.namespace + ":" : ""}${s.key}')`);
  }
  if (strings.length > 10) {
    messages.push(`  ... and ${strings.length - 10} more`);
  }

  return text(messages.join("\n"));
}
