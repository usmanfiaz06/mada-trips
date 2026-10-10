import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Integration tests for the Mada Trips Core API, against a real Postgres (see test/app/global-setup.ts).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(here, "src/$1") },
      { find: /^@mada\/shared$/, replacement: resolve(here, "../packages/shared/src/index.ts") },
      { find: /^zod$/, replacement: dirname(require.resolve("zod/package.json")) },
      { find: /^server-only$/, replacement: resolve(here, "test/app/server-only-stub.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/app/global-setup.ts"],
    setupFiles: ["test/app/setup-env.ts"],
    // One database, shared by every file: run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
