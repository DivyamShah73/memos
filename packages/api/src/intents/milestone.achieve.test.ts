import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedArtifact,
  seedBase,
  seedMilestone,
  seedObjective,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { milestones } from "../db/schema.js";

const A = "project.vitest-ma";
const B = "project.vitest-ma-other";
let token: string;
let bd: string;
let art: string;
let artB: string;
let mLow: string;
let mMed: string;
let mXt: string;
let mSolo: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-ma");

  bd = await seedWorkflowRun(A);
  art = await seedArtifact(A, bd); // evidence in project A + run bd
  const bdB = await seedWorkflowRun(B);
  artB = await seedArtifact(B, bdB); // evidence in another tenant

  const objMulti = await seedObjective(A, { title: "multi" });
  mLow = await seedMilestone(A, objMulti, { title: "low" });
  mMed = await seedMilestone(A, objMulti, { title: "med" });
  mXt = await seedMilestone(A, objMulti, { title: "xt" });

  const objSolo = await seedObjective(A, { title: "solo" });
  mSolo = await seedMilestone(A, objSolo, { title: "solo ms" });
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("milestone.achieve", () => {
  it("flips status + stores the achievement snapshot (low confidence, no evidence)", async () => {
    const { status, json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mLow,
      claim: "we shipped it",
      confidence: "low",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("achieved");

    const [row] = await ownerDb
      .select({ status: milestones.status, achievedAt: milestones.achievedAt, achievement: milestones.achievement })
      .from(milestones)
      .where(eq(milestones.id, mLow));
    expect(row.status).toBe("achieved");
    expect(row.achievedAt).not.toBeNull();
    expect((row.achievement as any).claim).toBe("we shipped it");
    expect((row.achievement as any).agent_id).toMatch(/^agent\./);
  });

  it("evidence gate: medium without evidence → 400", async () => {
    const { status, json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mMed,
      claim: "metric hit",
      confidence: "medium",
    });
    expect(status).toBe(400);
    expect(json.detail.field_errors["evidence_artifact_id"]).toBeDefined();
  });

  it("medium WITH in-run evidence is accepted", async () => {
    const { json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mMed,
      claim: "metric hit",
      confidence: "medium",
      evidence_artifact_id: art,
    });
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("achieved");
  });

  it("rejects a cross-tenant evidence cite (ok:false)", async () => {
    const { status, json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mXt,
      claim: "borrowed proof",
      confidence: "high",
      evidence_artifact_id: artB, // belongs to project B's run
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this run/);
  });

  it("rejects achieving an already-achieved milestone (ok:false)", async () => {
    const { json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mLow,
      claim: "again",
      confidence: "low",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/already achieved/);
  });

  it("an achieved solo milestone rolls its objective up to progress 1", async () => {
    const { json } = await call("milestone.achieve", token, {
      project_id: A,
      bd_id: bd,
      milestone_id: mSolo,
      claim: "done",
      confidence: "low",
    });
    expect(json.ok).toBe(true);
    expect(json.data.objective_progress).toBe(1);
  });
});
