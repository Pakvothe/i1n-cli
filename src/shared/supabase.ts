import { createClient } from "@supabase/supabase-js";
import type {
  AddLanguageResponse,
  EstimateTranslateResponse,
  ProjectLimitsResponse,
  ProjectSettingsResponse,
  PullResponse,
  PushResponse,
  TranslateResponse,
  TranslationProgressResponse,
  ValidateResponse,
} from "./types.js";

// Default: production. Override with env vars for local development.
const SUPABASE_URL =
  process.env.I1N_SUPABASE_URL || "https://obbmugzyikyownlqhfip.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.I1N_SUPABASE_ANON_KEY ||
  "sb_publishable_gkQ07M9FkSNL2RHmseUJlQ_ruhytKsq";

type Action =
  | "validate"
  | "push"
  | "pull"
  | "translate"
  | "estimate-translate"
  | "translation-progress"
  | "project-settings"
  | "project-limits"
  | "add-language";

type ActionResponseMap = {
  validate: ValidateResponse;
  push: PushResponse;
  pull: PullResponse;
  translate: TranslateResponse;
  "estimate-translate": EstimateTranslateResponse;
  "translation-progress": TranslationProgressResponse;
  "project-settings": ProjectSettingsResponse;
  "project-limits": ProjectLimitsResponse;
  "add-language": AddLanguageResponse;
};

// Singleton client — reuse across all calls to avoid connection overhead
let _client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

export async function callCliSync<T extends Action>(
  action: T,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<ActionResponseMap[T]> {
  const client = getClient();

  const { data, error } = await client.functions.invoke("cli-sync", {
    body: { action, params },
    headers: { "x-i1n-key": apiKey },
  });

  if (error) {
    throw new Error(error.message ?? `Request failed: ${action}`);
  }

  return data as ActionResponseMap[T];
}
