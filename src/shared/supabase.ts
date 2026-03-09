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

const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

type Action = "validate" | "push" | "pull" | "translate" | "estimate-translate" | "translation-progress" | "project-settings" | "project-limits" | "add-language";

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

export async function callCliSync<T extends Action>(
  action: T,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<ActionResponseMap[T]> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await client.functions.invoke("cli-sync", {
    body: { action, params },
    headers: { "x-i1n-key": apiKey },
  });

  if (error) {
    throw new Error(error.message ?? `Request failed: ${action}`);
  }

  return data as ActionResponseMap[T];
}
