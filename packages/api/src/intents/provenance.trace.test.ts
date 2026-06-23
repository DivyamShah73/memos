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
import { agents, learnings, workflowRuns } from "../db/schema.js";

const A = "project.vitest-prov";
const B = "project.vitest-prov-b";
let token: string;
let learningId: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await seedProject(B, false);
  token = await enrollAgent([A], "vitest-prov");
  const [me] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-prov"));

  const obj = await seedObjective(A, { title: "trace objective" });
  const bd = await seedWorkflowRun(A);
  // Bind the run to the objective so the chain reaches the OKR node.
  await ownerDb.update(workflowRuns).set({ targetObjectiveId: obj }).where(eq(workflowRuns.bdId, bd));
  const art = await seedArtifact(A, bd);
  const [row] = await ownerDb
    .insert(learnings)
    .values({
      projectId: A,
      bdId: bd,
      agentId: me.id,
      claim: "the traced learning",
      appliesTo: ["x"],
      confidence: "medium",
      nonObviousMarker: "a sufficiently long non-obvious marker",
      evidenceArtifactId: art,
    })
    .returning({ id: learnings.id });
  learningId = row.id;
});

afterAll(async () => {
  await cleanupAndClose([A, B]);
});

describe("provenance.trace", () => {
  it("returns the full lineage chain (learning, artifact, run, objective)", async () => {
    const { status, json } = await call("provenance.trace", token, {
      project_id: A,
      learning_id: learningId,
    });
    expect(status).toBe(200);
    const types: string[] = json.data.nodes.map((n: any) => n.type);
    expect(types).toEqual(expect.arrayContaining(["learning", "artifact", "run", "objective", "agent"]));
    // edges connect learning→artifact and run→objective
    const edgeLabels: string[] = json.data.edges.map((e: any) => e.label);
    expect(edgeLabels).toEqual(expect.arrayContaining(["cites", "recorded in", "advances"]));
  });

  it("rejects a learning not in this project (ok:false)", async () => {
    const { json } = await call("provenance.trace", token, {
      project_id: A,
      learning_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found in this project/);
  });

  it("rejects an out-of-scope project (403)", async () => {
    const { status } = await call("provenance.trace", token, { project_id: B, learning_id: learningId });
    expect(status).toBe(403);
  });
});
