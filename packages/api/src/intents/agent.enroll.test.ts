import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { app } from "../app.js";
import { db as ownerDb, queryClient } from "../db/index.js";
import { gatewayClient } from "../db/gateway.js";
import { agents, enrollmentCodes, orgs, teams } from "../db/schema.js";

// Fixtures are created with the OWNER client (bypasses RLS / GRANT gaps); the gateway
// (app) reads/writes as memos_app. Both hit the live docker `memos` DB.
// Test-owned ids (NOT the shared 'org'/'team.demo' that phase1.sh leaves behind) so
// teardown can never FK-collide with another harness's fixtures.
const ORG_ID = "org.vitest";
const TEAM_ID = "team.vitest";
const TEST_SCOPES = ["project.demo"];

function uniqueCode(): string {
  return `enr_code_vitest_${randomBytes(6).toString("hex")}`;
}

async function seedCode(code: string): Promise<void> {
  await ownerDb.insert(enrollmentCodes).values({ code, teamId: TEAM_ID, orgId: ORG_ID, scopes: TEST_SCOPES });
}

interface EnrollResult {
  status: number;
  // deliberately loose — we're asserting the wire shape
  json: any;
}

async function post(
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<EnrollResult> {
  const res = await app.request(`/v1/intent/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  await ownerDb.insert(orgs).values({ id: ORG_ID, name: "Test Org" }).onConflictDoNothing();
  await ownerDb
    .insert(teams)
    .values({ id: TEAM_ID, orgId: ORG_ID, name: "Test Team" })
    .onConflictDoNothing();
});

afterAll(async () => {
  try {
    // Only delete test-owned rows (vitest ids), in FK order. Nothing else references them.
    await ownerDb.delete(agents).where(like(agents.displayName, "vitest-%"));
    await ownerDb.delete(enrollmentCodes).where(like(enrollmentCodes.code, "enr_code_vitest_%"));
    await ownerDb.delete(teams).where(eq(teams.id, TEAM_ID));
    await ownerDb.delete(orgs).where(eq(orgs.id, ORG_ID));
  } finally {
    // Always close the pools, even if cleanup throws, so the run doesn't hang/leak.
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
});

describe("agent.enroll", () => {
  it("enrolls with a valid code and returns a syn_ token shown once", async () => {
    const code = uniqueCode();
    await seedCode(code);
    const { status, json } = await post("agent.enroll", { code, display_name: "vitest-happy" });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.api_token.raw).toMatch(/^syn_[A-Za-z0-9_-]+$/);
    expect(json.data.agent_id).toMatch(/^agent\.vitest-happy-[0-9a-f]{6}$/);
    expect(json.data.scopes).toEqual(TEST_SCOPES);
  });

  it("stores only the token HASH, never the raw token", async () => {
    const code = uniqueCode();
    await seedCode(code);
    const { json } = await post("agent.enroll", { code, display_name: "vitest-hash" });
    const raw: string = json.data.api_token.raw;
    const rows = await ownerDb
      .select({ hash: agents.apiTokenHash })
      .from(agents)
      .where(eq(agents.id, json.data.agent_id));
    expect(rows[0].hash).not.toBe(raw);
    expect(rows[0].hash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a reused code with ok:false (business rule, HTTP 200)", async () => {
    const code = uniqueCode();
    await seedCode(code);
    await post("agent.enroll", { code, display_name: "vitest-reuse1" });
    const { status, json } = await post("agent.enroll", { code, display_name: "vitest-reuse2" });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/already used/);
    expect(json.error_type).toBe("bad_request");
  });

  it("is single-use under concurrency — exactly one of two racing enrolls wins", async () => {
    const code = uniqueCode();
    await seedCode(code);
    const results = await Promise.all([
      post("agent.enroll", { code, display_name: "vitest-race-a" }),
      post("agent.enroll", { code, display_name: "vitest-race-b" }),
    ]);
    expect(results.filter((r) => r.json.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.json.ok === false)).toHaveLength(1);
  });

  it("rejects an unknown code with ok:false", async () => {
    const { status, json } = await post("agent.enroll", {
      code: "enr_code_vitest_does_not_exist",
      display_name: "vitest-invalid",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/invalid/);
  });

  it("returns 401 for a tokenless call to an authed (even unimplemented) intent", async () => {
    const { status, json } = await post("workflow.create", {});
    expect(status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error_type).toBe("unauthorized");
  });

  it("returns 400 with field_errors for a body missing required fields", async () => {
    const { status, json } = await post("agent.enroll", {});
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error_type).toBe("validation_error");
    expect(json.detail.field_errors.code).toBeDefined();
    expect(json.detail.field_errors.display_name).toBeDefined();
    expect(json.detail.first_error).toBeTruthy();
  });

  it("returns 400 for a non-JSON body", async () => {
    const { status, json } = await post("agent.enroll", "this is not json{");
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error_type).toBe("validation_error");
  });

  it("rejects an oversized request body with 413 (OOM guard)", async () => {
    // > the 8 MiB default cap; must be refused before buffering/handling.
    const huge = "x".repeat(9 * 1024 * 1024);
    const { status, json } = await post("agent.enroll", { code: "x", display_name: huge });
    expect(status).toBe(413);
    expect(json.ok).toBe(false);
  });
});
