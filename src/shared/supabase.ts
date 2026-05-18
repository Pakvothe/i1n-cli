import { createClient } from "@supabase/supabase-js";
import type {
  AddLanguageResponse,
  EstimateTranslateResponse,
  ProjectLimitsResponse,
  ProjectSettingsResponse,
  PullResponse,
  PullRevisionsResponse,
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
  | "pull-revisions"
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
  "pull-revisions": PullRevisionsResponse;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 600_000;

function getRequestTimeoutMs(): number {
  const raw = process.env.I1N_REQUEST_TIMEOUT_MS;
  if (!raw) return DEFAULT_REQUEST_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_REQUEST_TIMEOUT_MS) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(parsed, MAX_REQUEST_TIMEOUT_MS);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Request timeout after ${ms}ms (${label})`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callCliSync<T extends Action>(
  action: T,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<ActionResponseMap[T]> {
  const client = getClient();
  const timeoutMs = getRequestTimeoutMs();

  const { data, error } = await withTimeout(
    client.functions.invoke("cli-sync", {
      body: { action, params },
      headers: { "x-i1n-key": apiKey },
    }),
    timeoutMs,
    action,
  );

  if (error) {
    throw new Error(error.message ?? `Request failed: ${action}`);
  }

  return data as ActionResponseMap[T];
}
