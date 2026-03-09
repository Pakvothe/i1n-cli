declare module "i1n" {
  interface I1nKeys {
    "app.welcome": Record<string, never>;
  }

  type I1nKey = keyof I1nKeys;

  function t<K extends I1nKey>(
    key: K,
    ...args: I1nKeys[K] extends Record<string, never> ? [] : [variables: I1nKeys[K]]
  ): string;
}
