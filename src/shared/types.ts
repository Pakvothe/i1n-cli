export type Format =
  | "nested-json"
  | "flat-json"
  | "arb"
  | "yaml"
  | "android-xml"
  | "apple-strings"
  | "typescript";

export type Framework =
  | "i18next"
  | "next-intl"
  | "vue-i18n"
  | "expo"
  | "ngx-translate"
  | "flutter"
  | "rails"
  | "android"
  | "ios"
  | "generic";

export interface I1nProjectConfig {
  apiKey: string;
  projectId: string;
  localesDir: string;
  sourceLocale: string;
  format: Format;
  framework: Framework;
}

export interface Wording {
  key: string;
  namespace: string;
  value_json: Record<string, string>;
  description?: string;
  /**
   * Server's `updated_at` for this row, surfaced by `pull` and used by
   * subsequent `push` calls as an optimistic-concurrency token. Only set
   * on wordings that came from the server; locally-parsed wordings won't
   * have it.
   */
  updated_at?: string;
}

export interface Language {
  code: string;
  name: string;
}

export interface DetectionResult {
  framework: Framework;
  format: Format;
  localesDir: string;
  sourceLocale: string;
}

export interface ParseWarning {
  file: string;
  message: string;
}

export interface ParseResult {
  wordings: Wording[];
  warnings: ParseWarning[];
}

export interface I1nParser {
  read(localesDir: string, sourceLocale: string): ParseResult;
  write(localesDir: string, wordings: Wording[], languages: Language[]): void;
  extensions: string[];
}

export interface PushConflict {
  namespace: string;
  key: string;
  server_updated_at: string;
  server_value_json: Record<string, string>;
}

export interface PushResponse {
  created: number;
  updated: number;
  /**
   * Items the server attempted to merge but couldn't (transient DB
   * error inside a chunk). Set on v1.4+ servers; older servers omit.
   * The CLI surfaces this so partial-success pushes don't fail silently.
   */
  failed?: number;
  warning?: string;
  /**
   * Items the server refused to merge because the client's
   * `expected_updated_at` was older than the server's current
   * `updated_at`. Empty for non-optimistic-concurrency pushes and on
   * servers that don't implement the v2 RPC.
   */
  conflicts?: PushConflict[];
}

export interface RevisionEntry {
  namespace: string;
  key: string;
  updated_at: string;
}

/** Lightweight metadata fetched by `pull-revisions` for pre-push drift
 * detection. Stripped of `value_json`/`description` so the payload is
 * tiny even for projects with thousands of keys. */
export interface PullRevisionsResponse {
  revisions: RevisionEntry[];
}

export interface PullResponse {
  wordings: Wording[];
  languages: Language[];
  namespaces: { name: string; description?: string }[];
}

export interface TranslateResponse {
  cached: Record<string, string>;
  queued: number;
  credits_used: number;
}

export interface EstimateTranslateResponse {
  available_credits: number;
  credits_limit: number;
  plan_id: string;
  cache_cost_per_item: number;
  ai_cost_per_item: number;
  cache_count: number;
  ai_count: number;
  estimated_cost: number;
  languages: { code: string; cached: number; ai: number }[];
}

export interface TranslationProgressResponse {
  total: number;
  completed: number;
  remaining: number;
  status: "processing" | "done";
}

export interface ValidateResponse {
  org_id: string;
  org_name: string;
  projects: {
    id: string;
    name: string;
    used_languages: string[];
    is_locked: boolean;
  }[];
}

export type TonePreset =
  | "formal"
  | "friendly"
  | "technical"
  | "concise"
  | "custom";

export interface ProjectSettingsResponse {
  tone_preset: TonePreset;
  brand_voice: string | null;
}

export interface ProjectLimitsResponse {
  plan_id: string;
  is_locked: boolean;
  wordings: { used: number; limit: number };
  credits: { used: number; limit: number };
  languages: {
    active: string[];
    used: string[];
    limit: number;
    remaining_slots: number;
  };
  supported_codes: string[];
  available_languages: {
    code: string;
    name: string;
    flag: string;
    language: string;
  }[];
}

export interface AddLanguageResponse {
  added: string[];
  active_languages: string[];
}
