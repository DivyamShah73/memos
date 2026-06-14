/**
 * The most important test in the project: the evidence gate + non-obvious gate + the
 * cross-tenant evidence-borrowing rejection. If a medium/high write with no (or foreign)
 * evidence is ACCEPTED, the product is broken.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  seedArtifact,
  seedBase,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";

const P = "project.vitest-gate";
const POTHER = "project.vitest-gate-other";
let token: string;
let bd: string;
let artifactInP: string;
let artifactInOther: string;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  await seedBase();
  await seedProject(P, false);
  await seedProject(POTHER, false);
  token = await enrollAgent([P], "vitest-gate");
  bd = await seedWorkflowRun(P);

  // A real artifact in P (uploaded through the gateway), and an artifact ROW in another
  // project (owner-seeded) to prove cross-tenant cites are rejected.
  const up = await call("artifact.upload", token, {
    project_id: P,
    bd_id: bd,
    kind: "log",
    mime_type: "text/plain",
    content_base64: b64("evidence"),
  });
  artifactInP = up.json.data.artifact_id;
  const bdOther = await seedWorkflowRun(POTHER);
  artifactInOther = await seedArtifact(POTHER, bdOther);
});

afterAll(async () => {
  await cleanupAndClose([P, POTHER]);
});

describe("evidence gate", () => {
  it("ACCEPTS a low-confidence fact with no evidence", async () => {
    const { json } = await call("fact.record", token, {
      project_id: P,
      bd_id: bd,
      facts: [{ claim: "tentative observation", confidence: "low" }],
    });
    expect(json.ok).toBe(true);
    expect(json.data.fact_ids).toHaveLength(1);
  });

  it("REJECTS a medium fact with no evidence (400 + field_errors)", async () => {
    const { status, json } = await call("fact.record", token, {
      project_id: P,
      bd_id: bd,
      facts: [{ claim: "x", confidence: "medium" }],
    });
    expect(status).toBe(400);
    expect(json.error_type).toBe("validation_error");
    expect(json.detail.field_errors["facts.0.evidence_artifact_id"]).toBeDefined();
  });

  it("REJECTS a high learning with no non_obvious_marker (400)", async () => {
    const { status, json } = await call("learning.record", token, {
      project_id: P,
      bd_id: bd,
      learnings: [
        { claim: "x", applies_to: ["fine-tuning"], confidence: "high", evidence_artifact_id: artifactInP },
      ],
    });
    expect(status).toBe(400);
    expect(json.detail.field_errors["learnings.0.non_obvious_marker"]).toBeDefined();
  });

  it("REJECTS a learning whose non_obvious_marker is too short (<15)", async () => {
    const { status, json } = await call("learning.record", token, {
      project_id: P,
      bd_id: bd,
      learnings: [
        {
          claim: "x",
          applies_to: ["fine-tuning"],
          confidence: "medium",
          non_obvious_marker: "too short",
          evidence_artifact_id: artifactInP,
        },
      ],
    });
    expect(status).toBe(400);
    expect(json.detail.field_errors["learnings.0.non_obvious_marker"]).toBeDefined();
  });

  it("REJECTS a fact citing a non-existent artifact", async () => {
    const { json } = await call("fact.record", token, {
      project_id: P,
      bd_id: bd,
      facts: [
        { claim: "x", confidence: "medium", evidence_artifact_id: "00000000-0000-4000-8000-000000000000" },
      ],
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this run/);
  });

  it("REJECTS a fact citing another project's artifact (no cross-tenant evidence borrowing)", async () => {
    const { json } = await call("fact.record", token, {
      project_id: P,
      bd_id: bd,
      facts: [{ claim: "x", confidence: "high", evidence_artifact_id: artifactInOther }],
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this run/);
  });

  it("ACCEPTS a medium fact that cites a same-run artifact", async () => {
    const { json } = await call("fact.record", token, {
      project_id: P,
      bd_id: bd,
      facts: [{ claim: "D7 activation dropped 11pp", confidence: "medium", evidence_artifact_id: artifactInP }],
    });
    expect(json.ok).toBe(true);
    expect(json.data.fact_ids).toHaveLength(1);
  });

  it("ACCEPTS a medium learning with a valid marker + same-run evidence", async () => {
    const { json } = await call("learning.record", token, {
      project_id: P,
      bd_id: bd,
      learnings: [
        {
          claim: "LoRA rank 16 beats rank 32 at low sample counts",
          applies_to: ["fine-tuning", "lora", "low-data"],
          confidence: "medium",
          non_obvious_marker: "standard guidance scales rank with data; under ~200 samples it inverts",
          evidence_artifact_id: artifactInP,
        },
      ],
    });
    expect(json.ok).toBe(true);
    expect(json.data.learning_ids).toHaveLength(1);
  });
});
