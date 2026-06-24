import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Assumes the gateway is running on :8787 and seeded (`pnpm db:seed`); Playwright
 * starts the built web app on :3000 itself. Run: `pnpm --filter @memos/web test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // Single worker: specs share seeded accounts (ceo@acme.test) and the backend keeps ONE session
  // per user (single session_token_hash, ADR-011), so parallel files logging in as the same user
  // would clobber each other's session. Serialize to keep the suite deterministic.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build + run the PRODUCTION server (so SSE routes are pre-compiled and the live-feed connect
    // window holds — dev compiles /api/stream on first hit and misses it). COOKIE_INSECURE lets the
    // Secure session cookie round-trip over http://localhost for the test only (see lib/session.ts).
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...process.env, COOKIE_INSECURE: "1" },
  },
});
