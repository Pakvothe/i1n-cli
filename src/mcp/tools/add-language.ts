import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { executePull } from "../../cli/commands/pull.js";
import { text, error } from "./helpers.js";
import type { TranslationProgressResponse } from "../../shared/types.js";

async function waitForTranslation(
  projectId: string,
  apiKey: string,
): Promise<void> {
  let pollInterval = 1000;
  let lastCompleted = 0;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    let progress: TranslationProgressResponse;
    try {
      progress = await callCliSync(
        "translation-progress",
        { project_id: projectId },
        apiKey,
      );
    } catch {
      pollInterval = Math.min(pollInterval * 1.5, 5000);
      continue;
    }

    if (progress.status === "done") {
      return;
    }

    const madeProgress = progress.completed > lastCompleted;
    lastCompleted = progress.completed;

    if (madeProgress) {
      pollInterval = Math.max(1000, Math.min(2000, progress.remaining * 50));
    } else if (progress.completed > 0) {
      pollInterval = Math.min(3000, pollInterval * 1.2);
    } else {
      pollInterval = Math.min(pollInterval * 1.3, 5000);
    }
  }
}

export async function handleAddLanguage({
  languages,
  translate = true,
}: {
  languages: string;
  translate?: boolean;
}) {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  const selectedCodes = languages
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  if (selectedCodes.length === 0) {
    return error("No languages specified. Provide a comma-separated list (e.g. 'es,fr,de').");
  }

  const messages: string[] = [];

  // Fetch limits
  let limits;
  try {
    limits = await callCliSync(
      "project-limits",
      { project_id: config.projectId },
      config.apiKey,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Could not fetch project limits");
  }

  if (limits.is_locked) {
    return error("Project is locked (Read-Only). Upgrade your plan to enable adding languages.");
  }

  const { used, remaining_slots } = limits.languages;

  // Check slots
  const freshNew = selectedCodes.filter((c) => !used.includes(c));
  if (freshNew.length > remaining_slots) {
    return error(
      `Selected ${freshNew.length} new language(s) but only ${remaining_slots} slot(s) available. Upgrade your plan.`,
    );
  }

  // Add languages
  try {
    const result = await callCliSync(
      "add-language",
      { project_id: config.projectId, languages: selectedCodes },
      config.apiKey,
    );

    if (result.added.length > 0) {
      messages.push(`Added languages: ${result.added.join(", ")}`);
    } else {
      messages.push("Languages already active.");
    }
    messages.push(`Active languages: ${result.active_languages.join(", ")}`);
  } catch (err) {
    return error(err instanceof Error ? err.message : "Failed to add languages");
  }

  // Translate if requested (default true)
  if (translate) {
    let estimate;
    try {
      estimate = await callCliSync(
        "estimate-translate",
        {
          project_id: config.projectId,
          target_languages: selectedCodes,
        },
        config.apiKey,
      );
    } catch (err) {
      messages.push(`Warning: Could not estimate translation cost (${err instanceof Error ? err.message : "unknown error"}).`);
      return text(messages.join("\n"));
    }

    if (estimate.estimated_cost === 0) {
      messages.push("No translations needed.");
      return text(messages.join("\n"));
    }

    messages.push(`Translation estimate: ${estimate.estimated_cost} WU`);

    if (estimate.estimated_cost > estimate.available_credits) {
      messages.push(
        `Warning: Insufficient credits (${estimate.available_credits} available). Translation skipped.`,
      );
      return text(messages.join("\n"));
    }

    // Execute translation
    try {
      const translateResult = await callCliSync(
        "translate",
        {
          project_id: config.projectId,
          target_languages: selectedCodes,
        },
        config.apiKey,
      );

      const cachedCount = Object.keys(translateResult.cached).length;
      if (cachedCount > 0) {
        messages.push(`${cachedCount} translations resolved from cache.`);
      }

      if (translateResult.queued > 0) {
        messages.push(`${translateResult.queued} items queued for AI translation. Waiting...`);
        await waitForTranslation(config.projectId, config.apiKey);
        messages.push("AI translation complete.");
      }

      if (translateResult.credits_used > 0) {
        messages.push(`Credits used: ${translateResult.credits_used} WU`);
      }
    } catch (err) {
      messages.push(`Warning: Translation failed (${err instanceof Error ? err.message : "unknown error"}).`);
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
  }

  return text(messages.join("\n"));
}
