import { createClient } from "@supabase/supabase-js";
import { getActorIdentity, type ActorIdentity } from "./actor.js";
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

// Actor identity is resolved once per process. git config / CI env
// don't change mid-run, and the resolver shells out to git (cheap
// but not free).
let _actor: ActorIdentity | null = null;
function getCachedActor(): ActorIdentity {
  if (!_actor) _actor = getActorIdentity();
  return _actor;
}

/**
 * Whether this invocation is from the MCP server rather than a direct
 * CLI call. Set by the MCP server's tool wrappers at boot time. The
 * server forwards this to the edge function via the `x-i1n-mcp`
 * header so audit_logs can distinguish CLI vs MCP-originated
 * mutations.
 */
let _isMCP = false;
export function markAsMCPRuntime(): void {
  _isMCP = true;
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
  const actor = getCachedActor();

  // Actor headers — best-effort identity hints for audit_logs. The
  // server treats these as unverified; the API key remains the auth
  // boundary. Older edge function deployments without the audit_logs
  // feature simply ignore the unknown headers.
  //
  // HTTP headers are constrained to ASCII (RFC 7230 §3.2.4) and
  // undici/fetch will throw on non-ASCII bytes. Devs with accented
  // git names ("François") or non-Latin scripts would otherwise
  // crash every CLI call. Strip to printable ASCII; downstream
  // treats this as an unverified hint anyway.
  const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, "").trim();
  const headers: Record<string, string> = { "x-i1n-key": apiKey };
  if (_isMCP) headers["x-i1n-mcp"] = "1";
  if (actor.email) {
    const v = ascii(actor.email);
    if (v) headers["x-i1n-actor-email"] = v;
  }
  if (actor.name) {
    const v = ascii(actor.name);
    if (v) headers["x-i1n-actor-name"] = v;
  }
  if (actor.source) headers["x-i1n-actor-source"] = actor.source;

  const { data, error } = await withTimeout(
    client.functions.invoke("cli-sync", {
      body: { action, params },
      headers,
    }),
    timeoutMs,
    action,
  );

  if (error) {
    throw new Error(error.message ?? `Request failed: ${action}`);
  }

  return data as ActionResponseMap[T];
}
