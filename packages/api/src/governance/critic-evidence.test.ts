import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupAndClose,
  enrollAgent,
  ownerDb,
  seedBase,
  seedProject,
  seedWorkflowRun,
} from "../_testutil.js";
import { agents, briefs, learnings } from "../db/schema.js";
import { runEvidenceCritic } from "./critic-evidence.js";

const A = "project.vitest-crit";
let offender: string;
let bd: string;

beforeAll(async () => {
  await seedBase();
  await seedProject(A, false);
  await enrollAgent([A], "vitest-offender"); // a real agent (learnings.agent_id is an FK)
  const [a] = await ownerDb.select({ id: agents.id }).from(agents).where(eq(agents.displayName, "vitest-offender"));
  offender = a.id;
  bd = await seedWorkflowRun(A);
  // A medium-confidence learning with NO evidence — only reachable by bypassing the API gate
  // (here, a direct owner insert). This is exactly what the critic exists to catch.
  await ownerDb.insert(learnings).values({
    projectId: A,
    bdId: bd,
    agentId: offender,
    claim: "unbacked medium claim",
    appliesTo: ["x"],
    confidence: "medium",
  });
});

afterAll(async () => {
  await cleanupAndClose([A]);
});

describe("runEvidenceCritic", () => {
  it("files a brief at the offending agent, and is idempotent on re-run", async () => {
    const r1 = await runEvidenceCritic(ownerDb);
    expect(r1.filed).toBeGreaterThanOrEqual(1);

    const filed = await ownerDb
      .select({ targetKind: briefs.targetKind, authorId: briefs.authorId })
      .from(briefs)
      .where(eq(briefs.targetId, offender));
    expect(filed.length).toBe(1);
    expect(filed[0].targetKind).toBe("agent");
    expect(filed[0].authorId).toBe("critic.evidence");

    // Re-run must NOT duplicate the brief for the same violation.
    await runEvidenceCritic(ownerDb);
    const after = await ownerDb.select({ id: briefs.id }).from(briefs).where(eq(briefs.targetId, offender));
    expect(after.length).toBe(1);
  });
});
