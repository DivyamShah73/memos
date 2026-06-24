import { test, expect } from "@playwright/test";

// Phase 15 — public signup + the role-gated Admin page. Assumes the gateway is up + seeded
// (pnpm db:seed) and the web app is served by the webServer. Uses unique emails per run because
// user email is globally unique; throwaway signup orgs are harmless in the dev/test DB.

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  await page.reload(); // settle the post-login server-action cookie (see dashboard.spec)
}

test("public signup creates an org and lands on the dashboard as CEO", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/signup");
  await page.fill('input[name="org_name"]', `E2E Org ${stamp}`);
  await page.fill('input[name="display_name"]', "E2E Founder");
  await page.fill('input[name="email"]', `e2e-founder-${stamp}@signup.test`);
  await page.fill('input[name="password"]', "signup-strong-pw-1");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");
  await page.reload();
  // A CEO sees the role-gated Admin link.
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
});

test("CEO opens Admin → sees members, invites a user, mints a code", async ({ page }) => {
  await login(page, "ceo@acme.test", "demo-ceo-pass");
  await page.goto("/admin");
  await expect(page.getByText("Organization admin")).toBeVisible();
  await expect(page.getByText("ceo@acme.test")).toBeVisible(); // members table lists the CEO

  const stamp = Date.now();
  const email = `e2e-invite-${stamp}@acme.test`;
  await page.fill('input[name="display_name"]', "E2E Member");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "invite-strong-pw-1");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 }); // re-rendered member list

  await page.getByRole("button", { name: "Mint enrollment code" }).click();
  await expect(page.getByText(/^enr_/)).toBeVisible({ timeout: 10_000 }); // minted code shown
});

test("a member cannot access admin", async ({ page }) => {
  await login(page, "member@acme.test", "demo-member-pass");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0); // no sidebar link
  await page.goto("/admin");
  await expect(page.getByText(/need the manager or CEO role/i)).toBeVisible(); // not authorized
});
