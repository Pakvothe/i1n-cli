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

export interface I1nCredentials {
  api_key: string;
  project_id: string;
}

export interface I1nProjectConfig {
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

export interface PushResponse {
  created: number;
  updated: number;
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

export interface ValidateResponse {
  org_id: string;
  org_name: string;
  projects: { id: string; name: string }[];
}
