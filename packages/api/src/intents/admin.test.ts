/**
 * Phase 14 / ADR-012 — self-serve admin & lifecycle, end-to-end in-process:
 * org.signup (public) → CEO mints an agent code → agent enrolls → CEO invites a user → offboard
 * disables that user's login → agent.revoke kills the agent's token → a member cannot administer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as ownerDb, queryClient } from "../db/index.js";
import { gatewayClient } from "../db/gateway.js";
import { call } from "../_testutil.js";
import {
  agents, auditLog, enrollmentCodes, memberships, orgs, projects, teams, users,
} from "../db/schema.js";

let orgId = "";
let ceoToken = "";
let projectId = "";

beforeAll(async () => {
  const { json } = await call("org.signup", null, {
    org_name: "Admin Test Co", email: "founder@admintest.co", password: "founder-strong-pw-1",
  });
  orgId = json.data.org_id;
  ceoToken = json.data.api_token.raw;
  projectId = json.data.projects[0];
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

describe("self-serve admin loop", () => {
  it("org.signup returns a CEO session + the org's first project", () => {
    expect(orgId).toMatch(/^org\./);
    expect(ceoToken).toMatch(/^syn_/);
    expect(projectId).toMatch(/^project\./);
  });

  it("CEO mints an agent code → an agent enrolls with it and can authenticate", async () => {
    const mint = await call("enrollment.create", ceoToken, { project_id: projectId, role: "member" });
    expect(mint.json.ok).toBe(true);
    const code = mint.json.data.code;

    const enr = await call("agent.enroll", null, { code, display_name: "admin-test-agent" });
    expect(enr.json.ok).toBe(true);
    const agentTok = enr.json.data.api_token.raw;

    // the new agent works (a read in scope is not 403/401)
    const q = await call("learning.query", agentTok, { project_id: projectId, query: "x" });
    expect(q.status).not.toBe(401);
    expect(q.status).not.toBe(403);

    // a MEMBER agent cannot administer (enrollment.create is admin → 403)
    const denied = await call("enrollment.create", agentTok, { project_id: projectId });
    expect(denied.status).toBe(403);

    // agent.revoke kills the agent's token immediately
    const enrolledId = enr.json.data.agent_id;
    const rev = await call("agent.revoke", ceoToken, { agent_id: enrolledId });
    expect(rev.json.ok).toBe(true);
    const after = await call("agent.me", agentTok, {});
    expect(after.status).toBe(401);
  });

  it("CEO invites a user who can log in — then offboarding disables that login", async () => {
    const inv = await call("user.invite", ceoToken, {
      email: "invitee@admintest.co", password: "invitee-strong-pw-2",
      display_name: "Invitee", role: "member", scope_kind: "project", scope_id: projectId,
    });
    expect(inv.json.ok).toBe(true);
    const userId = inv.json.data.user_id;

    const login1 = await call("user.login", null, { email: "invitee@admintest.co", password: "invitee-strong-pw-2" });
    expect(login1.json.ok).toBe(true);

    const off = await call("member.offboard", ceoToken, { user_id: userId });
    expect(off.json.ok).toBe(true);

    const login2 = await call("user.login", null, { email: "invitee@admintest.co", password: "invitee-strong-pw-2" });
    expect(login2.status).toBe(401);
  });

  it("admin actions are recorded in the audit log", async () => {
    const rows = await ownerDb.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.orgId, orgId));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("org.signup");
    expect(actions).toContain("enrollment.create");
    expect(actions).toContain("member.offboard");
  });
});
