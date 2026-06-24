/**
 * Regression: the live-activity SSE route (/v1/stream/activity) must authenticate a logged-in USER
 * principal, not just an agent (Phase 13 / ADR-011). The dashboard's Next proxy opens this stream
 * with the user's session token; before the fix the route only ran resolveAgent, so every human's
 * live feed 401'd. We assert a valid user token is *authenticated* by the route — an out-of-scope
 * project returns 403 (authed, not scoped), NOT 401 (auth failed). The 403/401 branches return
 * before the stream opens, so these calls don't hang.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./app.js";
import { db as ownerDb, queryClient } from "./db/index.js";
import { gatewayClient } from "./db/gateway.js";
import { call } from "./_testutil.js";
import { agents, auditLog, enrollmentCodes, memberships, orgs, projects, teams, users } from "./db/schema.js";

let orgId = "";
let userToken = "";
let inScopeProject = "";

function streamRequest(token: string | null, projectId: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(`/v1/stream/activity?project_id=${encodeURIComponent(projectId)}`, { headers });
}

beforeAll(async () => {
  const { json } = await call("org.signup", null, {
    org_name: "Stream Test Co", email: "founder@streamtest.co", password: "stream-strong-pw-1",
  });
  orgId = json.data.org_id;
  userToken = json.data.api_token.raw; // a USER (CEO) session token
  inScopeProject = json.data.projects[0];
});

afterAll(async () => {
  try {
    for (const t of [auditLog, memberships, users, enrollmentCodes, agents, projects, teams]) {
      await ownerDb.delete(t).where(eq((t as typeof agents).orgId, orgId));
    }
    await ownerDb.delete(orgs).where(eq(orgs.id, orgId));
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
});

describe("/v1/stream/activity user-principal auth (ADR-011 regression)", () => {
  it("rejects a missing token with 401", async () => {
    const res = await streamRequest(null, inScopeProject);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token with 401", async () => {
    const res = await streamRequest("syn_not_a_real_token", inScopeProject);
    expect(res.status).toBe(401);
  });

  it("AUTHENTICATES a user token: out-of-scope project → 403 (not 401)", async () => {
    // The fix: the route resolves the user principal, so this is a scope failure (403), not an
    // auth failure (401). A 401 here is the exact regression we're guarding against.
    const res = await streamRequest(userToken, "project.not-in-this-users-scope");
    expect(res.status).toBe(403);
  });
});
