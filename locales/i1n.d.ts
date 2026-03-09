declare module "i1n" {
  interface I1nKeys {
    "app.welcome": Record<string, never>;
  }

  type I1nKey = keyof I1nKeys;

  function t<K extends I1nKey>(
    key: K,
    ...args: I1nKeys[K] extends Record<string, never> ? [] : [variables: I1nKeys[K]]
  ): string;

  function init(options: { locale: string; resources: Record<string, any> }): void;
  function setLocale(locale: string): void;
  function getLocale(): string;

  type EngineFn = (key: string, params?: Record<string, any>) => string;
  function registerI1n(engine: EngineFn | null): void;
}
