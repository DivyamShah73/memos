/**
 * Phase 11 / ADR-009 — the headline proof: people (users + memberships) are isolated ACROSS ORGS
 * at the database. Org A's scope sees only org A's people; org B's only org B's; an unset org GUC
 * denies all. Plus human auth: password verify + CEO scope resolution. (Project-scoped agent
 * isolation is proven separately in tenant-isolation.test.ts and stays green.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db as ownerDb, queryClient } from "../db/index.js";
import { gatewayDb, gatewayClient } from "../db/gateway.js";
import { makeWithScope } from "./scope.js";
import { loginUser, provisionOrg, resolveUserScope } from "./users.js";
import { memberships, orgs, projects, teams, users } from "../db/schema.js";

const A = {
  orgId: "org.mt-a", orgName: "MultiTest A", teamId: "team.mt-a", projectId: "project.mt-a",
  ceoEmail: "a-ceo@mt.test", ceoPassword: "pw-a-strong-9271", ceoName: "A CEO",
};
const B = {
  orgId: "org.mt-b", orgName: "MultiTest B", teamId: "team.mt-b", projectId: "project.mt-b",
  ceoEmail: "b-ceo@mt.test", ceoPassword: "pw-b-strong-4417", ceoName: "B CEO",
};
const ORG_IDS = [A.orgId, B.orgId];

let aUserId: string;

beforeAll(async () => {
  ({ userId: aUserId } = await provisionOrg(A));
  await provisionOrg(B);
});

afterAll(async () => {
  try {
    await ownerDb.delete(memberships).where(inArray(memberships.orgId, ORG_IDS));
    await ownerDb.delete(users).where(inArray(users.orgId, ORG_IDS));
    await ownerDb.delete(projects).where(inArray(projects.orgId, ORG_IDS));
    await ownerDb.delete(teams).where(inArray(teams.orgId, ORG_IDS));
    await ownerDb.delete(orgs).where(inArray(orgs.id, ORG_IDS));
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
});

describe("multi-org isolation (control plane, DB-enforced)", () => {
  it("org A's scope sees only org A's users — never org B's", async () => {
    const withA = makeWithScope(gatewayDb, [], [], A.orgId);
    const rows = await withA((tx) => tx.select({ email: users.email, orgId: users.orgId }).from(users));
    const emails = rows.map((r) => r.email.toLowerCase());
    expect(emails).toContain(A.ceoEmail);
    expect(emails).not.toContain(B.ceoEmail);
    expect(rows.every((r) => r.orgId === A.orgId)).toBe(true);
  });

  it("org B's scope sees only org B's users (symmetric)", async () => {
    const withB = makeWithScope(gatewayDb, [], [], B.orgId);
    const rows = await withB((tx) => tx.select({ email: users.email }).from(users));
    const emails = rows.map((r) => r.email.toLowerCase());
    expect(emails).toContain(B.ceoEmail);
    expect(emails).not.toContain(A.ceoEmail);
  });

  it("memberships are org-isolated too", async () => {
    const withA = makeWithScope(gatewayDb, [], [], A.orgId);
    const rows = await withA((tx) => tx.select({ orgId: memberships.orgId }).from(memberships));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === A.orgId)).toBe(true);
  });

  it("an unset org GUC denies all (default-deny, like the project GUC)", async () => {
    const withNone = makeWithScope(gatewayDb, [], [], null);
    const rows = await withNone((tx) => tx.select().from(users));
    expect(rows).toHaveLength(0);
  });
});

describe("human auth", () => {
  it("loginUser accepts the right password and resolves the org", async () => {
    const u = await loginUser(A.ceoEmail, A.ceoPassword);
    expect(u).not.toBeNull();
    expect(u?.orgId).toBe(A.orgId);
    expect(u?.userId).toBe(aUserId);
  });

  it("loginUser rejects a wrong password", async () => {
    expect(await loginUser(A.ceoEmail, "definitely-not-it")).toBeNull();
  });

  it("resolveUserScope gives a CEO their org's projects, not the other org's", async () => {
    const scope = await resolveUserScope(A.orgId, aUserId);
    expect(scope.roles).toContain("ceo");
    expect(scope.projects).toContain(A.projectId);
    expect(scope.projects).not.toContain(B.projectId);
  });
});
