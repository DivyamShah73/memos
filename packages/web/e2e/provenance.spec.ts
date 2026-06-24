import { test, expect } from "@playwright/test";

// Assumes the gateway is up + seeded (pnpm db:seed) and the web app is served by the webServer.

async function login(
  page: import("@playwright/test").Page,
  email = "ceo@acme.test",
  password = "demo-ceo-pass",
) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
}

test("provenance: clicking a learning lights up its lineage graph", async ({ page }) => {
  await login(page);
  await page.goto("/provenance");

  // The high-reuse, evidence-backed seeded learning is auto-selected (first by reuse).
  await expect(page.getByText(/batch size 32/i).first()).toBeVisible({ timeout: 15_000 });

  // Its lineage chain renders: the bound objective and the authoring agent are graph nodes.
  // (React Flow renders the graph after an async provenance.trace call, so allow generous time.)
  await expect(page.getByText(/Cut inference cost/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Scout").first()).toBeVisible({ timeout: 15_000 });
});

test("briefs: authoring a project-targeted brief surfaces it in the list", async ({ page }) => {
  // Authoring a brief is a manager action — the CEO is read-only (Phase 12), so sign in as the
  // seeded manager who can steer their team's project.
  await login(page, "manager@acme.test", "demo-manager-pass");
  await page.goto("/briefs");

  const title = `E2E brief ${Date.now()}`;
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="body"]', "cap vLLM batch size at 32");
  // defaults: target_kind=project, target_id=project.demo (so the operator sees it)
  await page.click('button[type="submit"]');

  await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
});
