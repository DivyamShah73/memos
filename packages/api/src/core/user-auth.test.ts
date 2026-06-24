/**
 * Phase 13 / ADR-011 — human login + user-principal auth. user.login returns a session token; the
 * gateway then authenticates that token as a user principal whose role + project scope come from
 * memberships, and the authz guard applies (CEO read-only, member can't steer). Proves the whole
 * per-user path in-process (no web).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db as ownerDb, queryClient } from "../db/index.js";
import { gatewayClient } from "../db/gateway.js";
import { call } from "../_testutil.js";
import { provisionOrg, provisionUser } from "./users.js";
import { memberships, orgs, projects, teams, users } from "../db/schema.js";

const ORG = "org.p13auth";
const TEAM = "team.p13auth";
const PROJ = "project.p13auth";
const CEO = { email: "p13-ceo@x.test", password: "p13-ceo-strong-1" };
const MGR = { email: "p13-mgr@x.test", password: "p13-mgr-strong-2" };
const MEM = { email: "p13-mem@x.test", password: "p13-mem-strong-3" };

async function login(email: string, password: string) {
  const { status, json } = await call("user.login", null, { email, password });
  return { status, json };
}
const tokenOf = (json: { data?: { api_token?: { raw?: string } } }) => json.data?.api_token?.raw ?? "";

beforeAll(async () => {
  await provisionOrg({
    orgId: ORG, orgName: "P13", teamId: TEAM, projectId: PROJ,
    ceoEmail: CEO.email, ceoPassword: CEO.password, ceoName: "P13 CEO",
  });
  await provisionUser({ orgId: ORG, email: MGR.email, password: MGR.password, displayName: "Mgr", role: "manager", scopeKind: "team", scopeId: TEAM });
  await provisionUser({ orgId: ORG, email: MEM.email, password: MEM.password, displayName: "Mem", role: "member", scopeKind: "project", scopeId: PROJ });
});

afterAll(async () => {
  try {
    await ownerDb.delete(memberships).where(inArray(memberships.orgId, [ORG]));
    await ownerDb.delete(users).where(inArray(users.orgId, [ORG]));
    await ownerDb.delete(projects).where(inArray(projects.orgId, [ORG]));
    await ownerDb.delete(teams).where(inArray(teams.orgId, [ORG]));
    await ownerDb.delete(orgs).where(inArray(orgs.id, [ORG]));
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
});

describe("user.login + user-principal auth", () => {
  it("CEO logs in: token, role ceo, org's project in scope", async () => {
    const { status, json } = await login(CEO.email, CEO.password);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.role).toBe("ceo");
    expect(json.data.projects).toContain(PROJ);
    expect(json.data.org_id).toBe(ORG);
  });

  it("wrong password → 401", async () => {
    const { status, json } = await login(CEO.email, "nope");
    expect(status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it("member can read but CANNOT steer (brief.create 403)", async () => {
    const tok = tokenOf((await login(MEM.email, MEM.password)).json);
    const read = await call("objective.query", tok, { project_id: PROJ });
    expect(read.status).not.toBe(403);
    const steer = await call("brief.create", tok, { project_id: PROJ, title: "t", body: "b", target_kind: "project", target_id: PROJ });
    expect(steer.status).toBe(403);
  });

  it("manager CAN steer (brief.create not 403)", async () => {
    const tok = tokenOf((await login(MGR.email, MGR.password)).json);
    const steer = await call("brief.create", tok, { project_id: PROJ, title: "t", body: "b", target_kind: "project", target_id: PROJ });
    expect(steer.status).not.toBe(403);
  });

  it("CEO is read-only (fact.record 403, objective.query allowed)", async () => {
    const tok = tokenOf((await login(CEO.email, CEO.password)).json);
    const write = await call("fact.record", tok, { project_id: PROJ, bd_id: "memos-x", facts: [{ claim: "y", confidence: "low" }] });
    expect(write.status).toBe(403);
    const read = await call("objective.query", tok, { project_id: PROJ });
    expect(read.status).not.toBe(403);
  });
});
