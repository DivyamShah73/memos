import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Assumes the gateway is running on :8787 and seeded (`pnpm db:seed`); Playwright
 * starts the built web app on :3000 itself. Run: `pnpm --filter @memos/web test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
