/**
 * Shared test helpers for the intent suites. NOT a *.test.ts so vitest doesn't run it.
 *
 * Fixtures are created with the OWNER client (the `postgres` superuser, which bypasses RLS
 * unconditionally — FORCE only binds a non-superuser table-owner, see ADR-002), so seeding
 * cross-tenant data needs no GUC. The gateway (app) runs as memos_app, where RLS bites.
 */
import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { app } from "./app.js";
import { db as ownerDb, queryClient } from "./db/index.js";
import { gatewayClient } from "./db/gateway.js";
import {
  agents,
  checkins,
  enrollmentCodes,
  objectives,
  orgs,
  projects,
  teams,
  workflowRuns,
} from "./db/schema.js";

export { ownerDb };

export const TEST_ORG = "org.vitest";
export const TEST_TEAM = "team.vitest";

export interface CallResult {
  status: number;
  json: any;
}

/** POST an intent through the in-process app (optionally authed). */
export async function call(
  intent: string,
  token: string | null,
  body: unknown,
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request(`/v1/intent/${intent}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

export async function seedBase(): Promise<void> {
  await ownerDb.insert(orgs).values({ id: TEST_ORG, name: "Vitest Org" }).onConflictDoNothing();
  await ownerDb
    .insert(teams)
    .values({ id: TEST_TEAM, orgId: TEST_ORG, name: "Vitest Team" })
    .onConflictDoNothing();
}

export async function seedProject(id: string, okrsRequired = false): Promise<void> {
  await ownerDb
    .insert(projects)
    .values({ id, teamId: TEST_TEAM, name: id, okrsRequired })
    .onConflictDoNothing();
}

export async function seedObjective(projectId: string, status = "active"): Promise<string> {
  const [row] = await ownerDb
    .insert(objectives)
    .values({ projectId, title: "vitest objective", status })
    .returning({ id: objectives.id });
  return row.id;
}

/** Mint a single-use code for the given scopes, enroll, and return the raw token. */
export async function enrollAgent(scopes: string[], displayName: string): Promise<string> {
  const code = `enr_code_vitest_${randomBytes(6).toString("hex")}`;
  await ownerDb.insert(enrollmentCodes).values({ code, teamId: TEST_TEAM, scopes });
  const { json } = await call("agent.enroll", null, { code, display_name: displayName });
  return json.data.api_token.raw as string;
}

/** Delete this run's rows in FK order for the given projects, then close the pools. */
export async function cleanupAndClose(projectIds: string[]): Promise<void> {
  try {
    for (const pid of projectIds) {
      await ownerDb.delete(checkins).where(eq(checkins.projectId, pid));
      await ownerDb.delete(workflowRuns).where(eq(workflowRuns.projectId, pid));
      await ownerDb.delete(objectives).where(eq(objectives.projectId, pid));
      await ownerDb.delete(projects).where(eq(projects.id, pid));
    }
    await ownerDb.delete(agents).where(like(agents.displayName, "vitest-%"));
    await ownerDb.delete(enrollmentCodes).where(like(enrollmentCodes.code, "enr_code_vitest_%"));
    await ownerDb.delete(teams).where(eq(teams.id, TEST_TEAM));
    await ownerDb.delete(orgs).where(eq(orgs.id, TEST_ORG));
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
}
