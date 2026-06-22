import { test, expect, request } from "@playwright/test";

const API = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MEMOS_OPERATOR_TOKEN ?? "syn_demo_operator_0000000000000000";
const PROJECT = "project.demo";
const BD = "memos-demo0001"; // the seeded, still-open run

test("login → OKR tree renders → a new fact streams into the live feed", async ({ page }) => {
  // 1. Login gate works.
  await page.goto("/login");
  await page.fill('input[name="password"]', "memos");
  await page.click('button[type="submit"]');
  await page.waitForURL("http://localhost:3000/");

  // 2. Dashboard renders the seeded OKR tree (with rollup bars).
  await expect(page.getByText("Cut inference cost 30%")).toBeVisible();
  await expect(page.getByText("Objectives & Key Results")).toBeVisible();
  await expect(page.getByText("Live activity")).toBeVisible();

  // 3. Post a fact straight to the gateway → it must appear in the feed live (SSE, no refresh).
  const marker = `e2e-fact-${Date.now()}`;
  const api = await request.newContext();
  const res = await api.post(`${API}/v1/intent/fact.record`, {
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    data: { project_id: PROJECT, bd_id: BD, facts: [{ claim: marker, confidence: "low" }] },
  });
  expect(res.ok()).toBeTruthy();

  await expect(page.getByText(marker)).toBeVisible({ timeout: 12_000 });
});
