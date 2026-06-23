import { test } from "@playwright/test";

// Opt-in: run with CAPTURE_SCREENSHOTS=1 to (re)generate the README images. Skipped in the
// normal e2e run so it doesn't churn committed PNGs. Requires the gateway up + `pnpm db:seed`.
test.skip(!process.env.CAPTURE_SCREENSHOTS, "set CAPTURE_SCREENSHOTS=1 to capture");

test.use({ viewport: { width: 1440, height: 900 } });

test("capture dashboard screenshots", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="password"]', "memos");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "../../docs/screenshots/console.png", fullPage: true });

  await page.goto("/provenance");
  await page.waitForTimeout(1400); // let React Flow lay out
  await page.screenshot({ path: "../../docs/screenshots/provenance.png", fullPage: true });

  await page.goto("/leaderboard");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "../../docs/screenshots/leaderboard.png", fullPage: true });

  await page.goto("/briefs");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "../../docs/screenshots/briefs.png", fullPage: true });
});
