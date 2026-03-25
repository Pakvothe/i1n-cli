import fs from "node:fs";
import path from "node:path";
import { readProjectConfig } from "../../shared/config.js";
import { callCliSync } from "../../shared/supabase.js";
import { getParser } from "../../parsers/index.js";
import { getChangedWordings, writePushState } from "../../shared/push-state.js";
import { normalizeWordingLanguages } from "../../shared/languages.js";
import { text, error } from "./helpers.js";

export async function handlePush() {
  const config = readProjectConfig();
  if (!config) {
    return error("No i1n.config.json found. Run `i1n init` first.");
  }

  const localesPath = path.resolve(config.localesDir);
  if (!fs.existsSync(localesPath)) {
    return error(`Directory not found: ${config.localesDir}. Update localesDir in i1n.config.json or run \`i1n init\` again.`);
  }

  // Read local files
  const parser = getParser(config.format);
  const { wordings, warnings } = parser.read(config.localesDir, config.sourceLocale);

  if (wordings.length === 0) {
    return text(`No translation keys found in ${localesPath}. Check your format setting in i1n.config.json.`);
  }

  // Fetch project limits
  let limits;
  try {
    limits = await callCliSync(
      "project-limits",
      { project_id: config.projectId },
      config.apiKey,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : "Could not check project limits");
  }

  if (limits.is_locked) {
    return error("Project is locked (Read-Only). Upgrade your plan to enable pushing translations.");
  }

  // Normalize language codes
  const messages: string[] = [];
  const allMappings = new Map<string, string>();
  const allUnsupported = new Set<string>();

  for (const wording of wordings) {
    const { normalized, mappings, unsupported } = normalizeWordingLanguages(
      wording.value_json,
      limits.supported_codes,
    );
    wording.value_json = normalized;
    for (const [from, to] of mappings) allMappings.set(from, to);
    for (const code of unsupported) allUnsupported.add(code);
  }

  for (const [from, to] of allMappings) {
    messages.push(`Normalized "${from}" → "${to}"`);
  }
  for (const code of allUnsupported) {
    messages.push(`Warning: Unknown language code "${code}". Skipping.`);
  }

  // Check language slots
  const localLangs = new Set<string>();
  for (const w of wordings) {
    for (const code of Object.keys(w.value_json)) {
      localLangs.add(code);
    }
  }

  const newLangs = [...localLangs].filter(
    (c) => !limits.languages.used.includes(c),
  );
  const exceededLangs = new Set<string>();

  if (newLangs.length > limits.languages.remaining_slots) {
    const allowed = new Set(
      newLangs.slice(0, limits.languages.remaining_slots),
    );
    for (const lang of newLangs) {
      if (!allowed.has(lang)) exceededLangs.add(lang);
    }

    for (const wording of wordings) {
      for (const lang of exceededLangs) {
        delete wording.value_json[lang];
      }
    }

    messages.push(
      `Warning: Language limit reached (${limits.languages.used.length}/${limits.languages.limit}). Skipping: ${[...exceededLangs].join(", ")}.`,
    );
  }

  // Cap at wording limit
  const wordingCapacity = limits.wordings.limit - limits.wordings.used;
  if (wordings.length > wordingCapacity && wordingCapacity >= 0) {
    const excess = wordings.length - wordingCapacity;
    wordings.splice(wordingCapacity);
    messages.push(
      `Warning: Wording limit reached (${limits.wordings.used}/${limits.wordings.limit}). Pushing ${wordingCapacity} keys, skipping ${excess}.`,
    );
  }

  if (wordings.length === 0) {
    return text("No keys to push after validation.\n" + messages.join("\n"));
  }

  // Diff against last push state
  const { changed, unchanged } = getChangedWordings(wordings, config.localesDir);

  if (changed.length === 0) {
    messages.push(`No changes detected (${unchanged} keys unchanged).`);
    return text(messages.join("\n"));
  }

  if (unchanged > 0) {
    messages.push(`${changed.length} changed, ${unchanged} unchanged (skipped).`);
  }

  // Batch push
  const BATCH_SIZE = 500;
  let totalCreated = 0;
  let totalUpdated = 0;

  try {
    for (let i = 0; i < changed.length; i += BATCH_SIZE) {
      const batch = changed.slice(i, i + BATCH_SIZE);
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

  // Save state after successful push
  writePushState(wordings, config.localesDir);

  messages.push(`Push complete: ${changed.length} keys synced (${totalCreated} created, ${totalUpdated} updated).`);

  if (warnings.length > 0) {
    messages.push("Parse warnings:");
    for (const w of warnings) {
      messages.push(`  ${w.file}: ${w.message}`);
    }
  }

  return text(messages.join("\n"));
}
