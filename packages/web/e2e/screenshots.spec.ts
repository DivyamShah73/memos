import { test } from "@playwright/test";

// Opt-in: run with CAPTURE_SCREENSHOTS=1 to (re)generate the README images. Skipped in the
// normal e2e run so it doesn't churn committed PNGs. Requires the gateway up + `pnpm db:seed`.
test.skip(!process.env.CAPTURE_SCREENSHOTS, "set CAPTURE_SCREENSHOTS=1 to capture");

test.use({ viewport: { width: 1440, height: 900 } });

test("capture dashboard screenshots", async ({ page }) => {
  // The per-user login gate (viewport shot — the centered card on the dark canvas).
  await page.goto("/login");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "../../docs/screenshots/login.png" });

  // The public self-serve signup page (Phase 15).
  await page.goto("/signup");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "../../docs/screenshots/signup.png" });

  await page.goto("/login");
  await page.fill('input[name="email"]', "ceo@acme.test");
  await page.fill('input[name="password"]', "demo-ceo-pass");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  await page.reload(); // settle the post-login server-action cookie (see dashboard.spec)
  await page.waitForTimeout(900);
  await page.screenshot({ path: "../../docs/screenshots/console.png", fullPage: true });

  await page.goto("/provenance");
  await page.waitForTimeout(1400); // let React Flow lay out
  await page.screenshot({ path: "../../docs/screenshots/provenance.png", fullPage: true });
  // A focused shot of just the React Flow lineage canvas (the full-page one renders it small).
  const flow = page.locator(".react-flow");
  if (await flow.count()) await flow.first().screenshot({ path: "../../docs/screenshots/graph.png" });

  await page.goto("/leaderboard");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "../../docs/screenshots/leaderboard.png", fullPage: true });

  await page.goto("/briefs");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "../../docs/screenshots/briefs.png", fullPage: true });

  // The role-gated admin page (Phase 15) — members + agents + enrollment, as the CEO.
  await page.goto("/admin");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "../../docs/screenshots/admin.png", fullPage: true });
});
