/**
 * Shared test helpers for the intent suites. NOT a *.test.ts so vitest doesn't run it.
 *
 * Fixtures are created with the OWNER client (the `postgres` superuser, which bypasses RLS
 * unconditionally — FORCE only binds a non-superuser table-owner, see ADR-002), so seeding
 * cross-tenant data needs no GUC. The gateway (app) runs as memos_app, where RLS bites.
 */
import { randomBytes } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import { app } from "./app.js";
import { db as ownerDb, queryClient } from "./db/index.js";
import { gatewayClient } from "./db/gateway.js";
import {
  agents,
  artifacts,
  briefAcks,
  briefs,
  checkins,
  enrollmentCodes,
  facts,
  feedback,
  learnings,
  milestones,
  objectives,
  orgs,
  projects,
  questions,
  teams,
  workflowRuns,
} from "./db/schema.js";

export { ownerDb };

export const TEST_ORG = "org.vitest";
export const TEST_TEAM = "team.vitest";

export interface CallResult {
  status: number;
  json: any;
}

/** POST an intent through the in-process app (optionally authed). */
export async function call(
  intent: string,
  token: string | null,
  body: unknown,
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request(`/v1/intent/${intent}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

export async function seedBase(): Promise<void> {
  await ownerDb.insert(orgs).values({ id: TEST_ORG, name: "Vitest Org" }).onConflictDoNothing();
  await ownerDb
    .insert(teams)
    .values({ id: TEST_TEAM, orgId: TEST_ORG, name: "Vitest Team" })
    .onConflictDoNothing();
}

export async function seedProject(id: string, okrsRequired = false): Promise<void> {
  await ownerDb
    .insert(projects)
    .values({ id, teamId: TEST_TEAM, orgId: TEST_ORG, name: id, okrsRequired })
    .onConflictDoNothing();
}

export interface SeedObjectiveOpts {
  status?: string;
  parentId?: string;
  weight?: number;
  bdId?: string;
  title?: string;
}

export async function seedObjective(
  projectId: string,
  opts: SeedObjectiveOpts | string = {},
): Promise<string> {
  // Back-compat: earlier callers pass a status string positionally.
  const o: SeedObjectiveOpts = typeof opts === "string" ? { status: opts } : opts;
  const [row] = await ownerDb
    .insert(objectives)
    .values({
      projectId,
      title: o.title ?? "vitest objective",
      status: o.status ?? "active",
      parentId: o.parentId ?? null,
      weight: o.weight !== undefined ? String(o.weight) : null,
      bdId: o.bdId ?? null,
    })
    .returning({ id: objectives.id });
  return row.id;
}

export interface SeedMilestoneOpts {
  title?: string;
  status?: string;
  metricTarget?: number;
  metricCurrent?: number;
  metricUnit?: string;
  metricDirection?: "up" | "down";
  position?: number;
}

export async function seedMilestone(
  projectId: string,
  objectiveId: string,
  opts: SeedMilestoneOpts = {},
): Promise<string> {
  const [row] = await ownerDb
    .insert(milestones)
    .values({
      projectId,
      objectiveId,
      title: opts.title ?? "vitest milestone",
      status: opts.status ?? "pending",
      metricTarget: opts.metricTarget !== undefined ? String(opts.metricTarget) : null,
      metricCurrent: opts.metricCurrent !== undefined ? String(opts.metricCurrent) : null,
      metricUnit: opts.metricUnit ?? null,
      metricDirection: opts.metricDirection ?? null,
      position: opts.position ?? null,
    })
    .returning({ id: milestones.id });
  return row.id;
}

/** Open a workflow run via the owner client (bypasses RLS); returns its bd_id. */
export async function seedWorkflowRun(projectId: string): Promise<string> {
  const bdId = `memos-${randomBytes(4).toString("hex")}`;
  await ownerDb
    .insert(workflowRuns)
    .values({ bdId, projectId, workflowClass: "test", title: "vitest run" });
  return bdId;
}

export interface SeedBriefOpts {
  title?: string;
  body?: string;
  authorId?: string;
  supersedesId?: string;
  effectiveFrom?: Date;
}

/** Insert a brief via the owner client (bypasses RLS). targetKind ∈ org|team|project|agent. */
export async function seedBrief(
  targetKind: string,
  targetId: string,
  opts: SeedBriefOpts = {},
): Promise<string> {
  const [row] = await ownerDb
    .insert(briefs)
    .values({
      title: opts.title ?? "vitest brief",
      body: opts.body ?? "vitest brief body",
      targetKind,
      targetId,
      authorId: opts.authorId ?? "vitest",
      supersedesId: opts.supersedesId ?? null,
      effectiveFrom: opts.effectiveFrom ?? undefined,
    })
    .returning({ id: briefs.id });
  return row.id;
}

export interface SeedQuestionOpts {
  bdId?: string;
  subject?: string;
  body?: string;
  urgency?: "low" | "medium" | "high";
  status?: string;
}

/** Insert a question via the owner client. */
export async function seedQuestion(
  projectId: string,
  agentId: string,
  opts: SeedQuestionOpts = {},
): Promise<string> {
  const [row] = await ownerDb
    .insert(questions)
    .values({
      projectId,
      agentId,
      bdId: opts.bdId ?? null,
      subject: opts.subject ?? "vitest question",
      body: opts.body ?? "why?",
      urgency: opts.urgency ?? null,
      status: opts.status ?? "open",
    })
    .returning({ id: questions.id });
  return row.id;
}

/** Insert an artifacts METADATA row via the owner client (no blob). For cite-check tests. */
export async function seedArtifact(projectId: string, bdId: string): Promise<string> {
  const [row] = await ownerDb
    .insert(artifacts)
    .values({
      projectId,
      bdId,
      kind: "log",
      mimeType: "text/plain",
      bucketPath: `${projectId}/seed`,
      sizeBytes: 1,
      sha256: "0".repeat(64),
    })
    .returning({ id: artifacts.id });
  return row.id;
}

/** Insert a fact row via the owner client (no gate; for query tests). */
export async function seedFact(
  projectId: string,
  bdId: string,
  claim: string,
  confidence = "low",
): Promise<string> {
  const [row] = await ownerDb
    .insert(facts)
    .values({ projectId, bdId, claim, confidence })
    .returning({ id: facts.id });
  return row.id;
}

/** Insert a learning row via the owner client (no gate; for query tests). */
export async function seedLearning(
  projectId: string,
  bdId: string,
  claim: string,
  appliesTo: string[],
  confidence = "low",
): Promise<string> {
  const [row] = await ownerDb
    .insert(learnings)
    .values({ projectId, bdId, claim, appliesTo, confidence })
    .returning({ id: learnings.id });
  return row.id;
}

/** Mint a single-use code for the given scopes, enroll, and return the raw token. */
export async function enrollAgent(scopes: string[], displayName: string): Promise<string> {
  const code = `enr_code_vitest_${randomBytes(6).toString("hex")}`;
  await ownerDb.insert(enrollmentCodes).values({ code, teamId: TEST_TEAM, orgId: TEST_ORG, scopes });
  const { json } = await call("agent.enroll", null, { code, display_name: displayName });
  return json.data.api_token.raw as string;
}

/** Delete this run's rows in FK order for the given projects, then close the pools. */
export async function cleanupAndClose(projectIds: string[]): Promise<void> {
  try {
    for (const pid of projectIds) {
      // FK order: facts/learnings → artifacts/workflow_runs; artifacts/checkins/milestones →
      // workflow_runs/objectives; workflow_runs/milestones → objectives; objectives → projects.
      await ownerDb.delete(facts).where(eq(facts.projectId, pid));
      await ownerDb.delete(learnings).where(eq(learnings.projectId, pid));
      await ownerDb.delete(checkins).where(eq(checkins.projectId, pid));
      await ownerDb.delete(artifacts).where(eq(artifacts.projectId, pid));
      await ownerDb.delete(milestones).where(eq(milestones.projectId, pid));
      await ownerDb.delete(workflowRuns).where(eq(workflowRuns.projectId, pid));
      // NULL the objectives self-FKs (parent_id, supersedes_id) first so a bulk delete can't
      // violate the self-reference mid-statement (parent removed before its child row).
      await ownerDb
        .update(objectives)
        .set({ parentId: null, supersedesId: null })
        .where(eq(objectives.projectId, pid));
      await ownerDb.delete(objectives).where(eq(objectives.projectId, pid));
      await ownerDb.delete(questions).where(eq(questions.projectId, pid));
      await ownerDb.delete(projects).where(eq(projects.id, pid));
    }

    // Briefs/acks/feedback are identity-targeted (not project-scoped). Clean up everything
    // touching the vitest agents + test identities. Must precede the agents delete (brief_acks
    // FKs agents). NULL supersedes_id first so the self-FK can't break a bulk delete.
    const vitestAgents = await ownerDb
      .select({ id: agents.id })
      .from(agents)
      .where(like(agents.displayName, "vitest-%"));
    const agentIds = vitestAgents.map((a) => a.id);
    if (agentIds.length > 0) {
      await ownerDb.delete(briefAcks).where(inArray(briefAcks.agentId, agentIds));
      await ownerDb.delete(feedback).where(inArray(feedback.agentId, agentIds));
    }
    const identityTargets = [TEST_ORG, TEST_TEAM, ...projectIds, ...agentIds];
    const authorIds = ["vitest", "critic.evidence", "governance.escalation", ...agentIds];
    const testBrief = or(inArray(briefs.targetId, identityTargets), inArray(briefs.authorId, authorIds));
    await ownerDb.update(briefs).set({ supersedesId: null }).where(testBrief); // self-FK first
    await ownerDb.delete(briefs).where(testBrief);

    await ownerDb.delete(agents).where(like(agents.displayName, "vitest-%"));
    await ownerDb.delete(enrollmentCodes).where(like(enrollmentCodes.code, "enr_code_vitest_%"));
    await ownerDb.delete(teams).where(eq(teams.id, TEST_TEAM));
    await ownerDb.delete(orgs).where(eq(orgs.id, TEST_ORG));
  } finally {
    await Promise.all([queryClient.end({ timeout: 5 }), gatewayClient.end({ timeout: 5 })]);
  }
}
