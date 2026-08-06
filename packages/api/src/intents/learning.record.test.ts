/**
 * learning.record — invariant 5: `applies_to` holds problem-domain terms, NEVER tenant ids.
 * A `project.*`/`team.*`/`agent.*` tag re-silos the learning, which is the one thing a shared
 * memory exists to prevent, so it is rejected in the Zod schema AND again in the handler.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { agents, learnings } from "../db/schema.js";
import { gatewayDb } from "../db/gateway.js";
import { makeWithScope } from "../core/scope.js";
import { learningRecord } from "./learning.record.js";

const P = "project.vitest-applies-to";
let token: string;
let agentId: string;
let bd: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(P, false);
  token = await enrollAgent([P], "vitest-applies-to");
  bd = await seedWorkflowRun(P);
  const [row] = await ownerDb
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.displayName, "vitest-applies-to"));
  agentId = row.id;
});

afterAll(async () => {
  await cleanupAndClose([P]);
});

// confidence: "low" keeps every case about applies_to alone — no evidence/marker gate in play.
const body = (applies_to: string[], claim = "batch size 8 saturates the GPU") => ({
  project_id: P,
  bd_id: bd,
  learnings: [{ claim, applies_to, confidence: "low" as const }],
});

describe("learning.record applies_to hygiene (invariant 5)", () => {
  for (const tag of ["project.acme", "team.platform", "agent.scout"]) {
    it(`REJECTS an id-shaped tag (${tag}) in the schema (400 + field error on that tag)`, async () => {
      const { status, json } = await call("learning.record", token, body(["fine-tuning", tag]));
      expect(status).toBe(400);
      expect(json.error_type).toBe("validation_error");
      expect(json.detail.field_errors["learnings.0.applies_to.1"]).toBeDefined();
    });
  }

  it("REJECTS an id-shaped tag disguised by case/whitespace (normalize THEN match)", async () => {
    const { status, json } = await call("learning.record", token, body(["  Project.Acme  "]));
    expect(status).toBe(400);
    expect(json.detail.field_errors["learnings.0.applies_to.0"]).toBeDefined();
  });

  it("REJECTS a whitespace-only tag (normalizing must not produce an empty tag)", async () => {
    const { status } = await call("learning.record", token, body(["   "]));
    expect(status).toBe(400);
  });

  it("ACCEPTS problem-domain tags, stored trimmed + lowercased", async () => {
    const { json } = await call(
      "learning.record",
      token,
      body([" VLLM-Deployment ", "fine-tuning"]),
    );
    expect(json.ok).toBe(true);
    const [row] = await ownerDb
      .select({ appliesTo: learnings.appliesTo })
      .from(learnings)
      .where(eq(learnings.id, json.data.learning_ids[0]));
    expect(row.appliesTo).toEqual(["vllm-deployment", "fine-tuning"]);
  });

  it("REJECTS an id-shaped tag in the HANDLER with the schema bypassed (defense in depth)", async () => {
    // Called with a REAL agent id + open run + low confidence, so this write would otherwise
    // SUCCEED — ok:false can only come from the handler's own tag check.
    const res = await learningRecord(
      {
        agent: {
          id: agentId,
          teamId: null,
          orgId: null,
          role: "member",
          scopes: [P],
          trustScore: "0",
        },
        db: gatewayDb,
        withScope: makeWithScope(gatewayDb, [P]),
        clientIp: "127.0.0.1",
      },
      body(["project.acme"], "handler-bypass attempt"),
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable"); // narrows the Envelope union
    expect(res.error).toMatch(/applies_to/);
  });
});
