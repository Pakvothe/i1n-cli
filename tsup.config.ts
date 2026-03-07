import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
    splitting: false,
    clean: true,
  },
  {
    entry: { index: "src/sdk/index.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    dts: true,
    splitting: false,
  },
]);
