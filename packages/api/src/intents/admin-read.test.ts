/**
 * Phase 15 — admin READ intents (member.list, agent.list) + agent.me role exposure.
 * Headline guarantees: (1) org isolation — org A's admin sees only A's people/agents, never B's;
 * (2) role gate — a member principal cannot enumerate the org (403); (3) agent.me carries `role`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db as ownerDb, queryClient } from "../db/index.js";
import { gatewayClient } from "../db/gateway.js";
import { call } from "../_testutil.js";
import {
  agents, auditLog, enrollmentCodes, memberships, orgs, projects, teams, users,
} from "../db/schema.js";

interface Ctx { orgId: string; ceoToken: string; projectId: string; }
const A: Ctx = { orgId: "", ceoToken: "", projectId: "" };
const B: Ctx = { orgId: "", ceoToken: "", projectId: "" };
let memberAgentTokenA = "";
let agentIdA = "";
let agentIdB = "";

async function signup(name: string, email: string): Promise<Ctx> {
  const { json } = await call("org.signup", null, { org_name: name, email, password: "founder-strong-pw-1" });
  return { orgId: json.data.org_id, ceoToken: json.data.api_token.raw, projectId: json.data.projects[0] };
}
async function enroll(ceoToken: string, projectId: string, name: string, role = "member"): Promise<{ token: string; id: string }> {
  const mint = await call("enrollment.create", ceoToken, { project_id: projectId, role });
  const enr = await call("agent.enroll", null, { code: mint.json.data.code, display_name: name });
  return { token: enr.json.data.api_token.raw, id: enr.json.data.agent_id };
}

beforeAll(async () => {
  Object.assign(A, await signup("Read Test A", "founder.a@readtest.co"));
  Object.assign(B, await signup("Read Test B", "founder.b@readtest.co"));
  // org A gets an invited human + a member agent; org B gets its own agent (for isolation checks).
  await call("user.invite", A.ceoToken, {
    email: "invitee.a@readtest.co", password: "invitee-strong-pw-2", display_name: "Invitee A",
    role: "member", scope_kind: "project", scope_id: A.projectId,
  });
  const ma = await enroll(A.ceoToken, A.projectId, "vitest-read-agent-a");
  memberAgentTokenA = ma.token; agentIdA = ma.id;
  agentIdB = (await enroll(B.ceoToken, B.projectId, "vitest-read-agent-b")).id;
});

afterAll(async () => {
  try {
    for (const orgId of [A.orgId, B.orgId]) {
      for (const t of [auditLog, memberships, users, enrollmentCodes, agents, projects, teams]) {
        await ownerDb.delete(t).where(eq((t as typeof agents).orgId, orgId));
      }
      await ownerDb.delete(orgs).where(eq(orgs.id, orgId));
    }
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
});

describe("agent.me exposes role (Phase 15)", () => {
  it("returns ceo for a CEO user token and member for a member agent", async () => {
    const ceo = await call("agent.me", A.ceoToken, {});
    expect(ceo.json.data.role).toBe("ceo");
    const member = await call("agent.me", memberAgentTokenA, {});
    expect(member.json.data.role).toBe("member");
  });
});

describe("member.list", () => {
  it("CEO sees their org's members (founder + invitee), org-isolated from the other org", async () => {
    const res = await call("member.list", A.ceoToken, {});
    expect(res.json.ok).toBe(true);
    const emails = res.json.data.members.map((m: { email: string }) => m.email);
    expect(emails).toContain("founder.a@readtest.co");
    expect(emails).toContain("invitee.a@readtest.co");
    expect(emails).not.toContain("founder.b@readtest.co"); // RLS org isolation
  });

  it("a member principal cannot list members (403)", async () => {
    const res = await call("member.list", memberAgentTokenA, {});
    expect(res.status).toBe(403);
  });
});

describe("agent.list", () => {
  it("CEO sees their org's agents, never another org's", async () => {
    const res = await call("agent.list", A.ceoToken, {});
    expect(res.json.ok).toBe(true);
    const ids = res.json.data.agents.map((a: { agent_id: string }) => a.agent_id);
    expect(ids).toContain(agentIdA);
    expect(ids).not.toContain(agentIdB); // org B's agent must not leak into org A's list
  });

  it("a member principal cannot list agents (403)", async () => {
    const res = await call("agent.list", memberAgentTokenA, {});
    expect(res.status).toBe(403);
  });
});
