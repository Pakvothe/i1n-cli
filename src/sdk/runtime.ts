import { replaceVariables } from "../shared/variables.js";

let translations: Record<string, Record<string, string>> = {};

export function init(options: {
  locale: string;
  translations: Record<string, Record<string, string>>;
}): void {
  translations = options.translations;
}

export function t(key: string, variables?: Record<string, string>): string {
  const dotIndex = key.indexOf(".");
  if (dotIndex === -1) return key;

  const namespace = key.substring(0, dotIndex);
  const actualKey = key.substring(dotIndex + 1);

  const value = translations[namespace]?.[actualKey];
  if (!value) return key;

  return variables ? replaceVariables(value, variables) : value;
}
