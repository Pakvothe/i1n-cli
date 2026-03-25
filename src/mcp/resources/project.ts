import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";

export async function getProjectResource(): Promise<string> {
  const config = readProjectConfig();
  if (!config) {
    return JSON.stringify({
      error: "No i1n.config.json found. Run `i1n init` first.",
    });
  }

  try {
    const limits = await callCliSync(
      "project-limits",
      { project_id: config.projectId },
      config.apiKey,
    );

    return JSON.stringify(
      {
        project_id: config.projectId,
        source_locale: config.sourceLocale,
        format: config.format,
        framework: config.framework,
        locales_dir: config.localesDir,
        plan: limits.plan_id,
        is_locked: limits.is_locked,
        wordings: limits.wordings,
        credits: limits.credits,
        languages: {
          active: limits.languages.active,
          used: limits.languages.used,
          limit: limits.languages.limit,
          remaining_slots: limits.languages.remaining_slots,
        },
        available_languages: limits.available_languages,
      },
      null,
      2,
    );
  } catch (err) {
    return JSON.stringify({
      project_id: config.projectId,
      source_locale: config.sourceLocale,
      format: config.format,
      framework: config.framework,
      locales_dir: config.localesDir,
      error: err instanceof Error ? err.message : "Failed to fetch project limits",
    });
  }
}
