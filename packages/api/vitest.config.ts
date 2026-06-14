import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Phase 0 has no logic tests yet, but `pnpm test` runs in the smoke suite from
    // the start — an empty run must exit 0 rather than fail "no test files found".
    passWithNoTests: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
