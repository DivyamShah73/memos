/**
 * Seed runner — `pnpm db:seed`. Demo data for the dashboard (Phase 7): an org/team/project, a
 * deterministic OPERATOR agent the dashboard authenticates as, an OKR tree with weighted
 * sub-OKRs + key results, and some recent activity for the live feed. Idempotent (fixed ids +
 * onConflictDoNothing), so re-running is safe. The richer demo seed is Phase 9.
 *
 * RLS note: this runs as the OWNER (the `postgres` superuser), which bypasses RLS — so seeding
 * RLS'd tables needs no `memos.agent_projects` GUC (see docs/decisions/002).
 *
 * The operator token is derived from MEMOS_OPERATOR_TOKEN (a dev default if unset) so the web
 * dashboard can hold the same value in its env and call the gateway as this agent.
 */
import "../env.js"; // side effect: loads the repo-root .env
import { createHash } from "node:crypto";
import { db, queryClient } from "./index.js";
import {
  agents,
  artifacts,
  briefs,
  checkins,
  facts,
  learnings,
  milestones,
  objectives,
  orgs,
  projects,
  teams,
  workflowRuns,
} from "./schema.js";

const OPERATOR_TOKEN = process.env.MEMOS_OPERATOR_TOKEN ?? "syn_demo_operator_0000000000000000";
const tokenHash = createHash("sha256").update(OPERATOR_TOKEN).digest("hex");

const BD = "memos-demo0001";
const BD2 = "memos-demo0002"; // a run BOUND to the root objective, for the full provenance chain
const O = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const M = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`;
const F = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;
const L = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;
const C = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const A = (n: number) => `f0000000-0000-4000-8000-00000000000${n}`;
const BR = (n: number) => `f1000000-0000-4000-8000-00000000000${n}`;
const dummyHash = (id: string) => createHash("sha256").update(`seed:${id}`).digest("hex");

async function run(): Promise<void> {
  await db.insert(orgs).values({ id: "org", name: "Acme AI" }).onConflictDoNothing();
  await db.insert(teams).values({ id: "team.demo", orgId: "org", name: "Platform" }).onConflictDoNothing();
  await db
    .insert(projects)
    .values({ id: "project.demo", teamId: "team.demo", name: "Inference Platform", okrsRequired: false })
    .onConflictDoNothing();

  // The operator the dashboard logs in as (token held server-side only).
  await db
    .insert(agents)
    .values({
      id: "agent.operator",
      displayName: "Operator",
      apiTokenHash: tokenHash,
      teamId: "team.demo",
      scopes: ["project.demo"],
      trustScore: "1.0",
    })
    .onConflictDoNothing();

  // A few teammates with varied trust scores, for the leaderboard. (Dummy token hashes — these
  // agents are seeded for display/provenance, not used to authenticate.)
  await db
    .insert(agents)
    .values([
      { id: "agent.scout", displayName: "Scout", apiTokenHash: dummyHash("scout"), teamId: "team.demo", scopes: ["project.demo"], trustScore: "0.9" },
      { id: "agent.builder", displayName: "Builder", apiTokenHash: dummyHash("builder"), teamId: "team.demo", scopes: ["project.demo"], trustScore: "0.7" },
      { id: "agent.novice", displayName: "Novice", apiTokenHash: dummyHash("novice"), teamId: "team.demo", scopes: ["project.demo"], trustScore: "0.4" },
    ])
    .onConflictDoNothing();

  await db
    .insert(workflowRuns)
    .values({ bdId: BD, projectId: "project.demo", agentId: "agent.operator", workflowClass: "investigation", title: "Reduce inference cost" })
    .onConflictDoNothing();

  // OKR tree: a parent with two weighted sub-OKRs, each carrying a key result.
  await db
    .insert(objectives)
    .values([
      { id: O(1), projectId: "project.demo", bdId: BD, agentId: "agent.operator", title: "Cut inference cost 30%", status: "active" },
      { id: O(2), projectId: "project.demo", parentId: O(1), weight: "2", bdId: BD, title: "Ship vLLM continuous batching", status: "active" },
      { id: O(3), projectId: "project.demo", parentId: O(1), weight: "1", bdId: BD, title: "Cache embeddings", status: "active" },
      // A second top-level objective for a fuller tree.
      { id: O(4), projectId: "project.demo", bdId: BD, agentId: "agent.operator", title: "Reach 95% eval coverage", status: "active" },
    ])
    .onConflictDoNothing();

  await db
    .insert(milestones)
    .values([
      { id: M(1), objectiveId: O(2), projectId: "project.demo", title: "p95 latency <= 200ms", metricTarget: "200", metricCurrent: "320", metricUnit: "ms", metricDirection: "down", status: "pending" },
      { id: M(2), objectiveId: O(3), projectId: "project.demo", title: "cache hit rate >= 90%", metricTarget: "90", metricCurrent: "45", metricUnit: "percent", metricDirection: "up", status: "pending" },
      { id: M(3), objectiveId: O(4), projectId: "project.demo", title: "eval coverage >= 95%", metricTarget: "95", metricCurrent: "78", metricUnit: "percent", metricDirection: "up", status: "pending" },
    ])
    .onConflictDoNothing();

  // A run BOUND to the root objective + an evidence artifact on it — the spine the provenance
  // graph walks (learning → artifact → run → OKR → agent).
  await db
    .insert(workflowRuns)
    .values({ bdId: BD2, projectId: "project.demo", agentId: "agent.scout", workflowClass: "benchmark", title: "Batching benchmark", targetObjectiveId: O(1) })
    .onConflictDoNothing();
  await db
    .insert(artifacts)
    .values([
      { id: A(1), projectId: "project.demo", bdId: BD2, kind: "benchmark", bucketPath: "project.demo/seed-benchmark", sizeBytes: 2048, sha256: "0".repeat(64) },
      { id: A(2), projectId: "project.demo", bdId: BD2, kind: "query_result", bucketPath: "project.demo/seed-evalrun", sizeBytes: 4096, sha256: "1".repeat(64) },
    ])
    .onConflictDoNothing();

  // Standing briefs the operator sees on the dashboard (targeting team/project/operator).
  await db
    .insert(briefs)
    .values([
      { id: BR(1), title: "Cite a benchmark for any latency claim", body: "Latency/throughput facts at medium+ confidence must attach a benchmark artifact.", targetKind: "team", targetId: "team.demo", authorId: "agent.operator" },
      { id: BR(2), title: "Prefer vLLM over TGI for batching", body: "Standardize on vLLM continuous batching for this project's inference workloads.", targetKind: "project", targetId: "project.demo", authorId: "agent.operator" },
      { id: BR(3), title: "Review the cost dashboard weekly", body: "Check inference cost per 1k tokens every Monday and log a fact if it moves >5%.", targetKind: "agent", targetId: "agent.operator", authorId: "agent.operator" },
    ])
    .onConflictDoNothing();

  // Recent activity for the live feed.
  await db
    .insert(facts)
    .values([
      { id: F(1), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "vLLM batching cut p95 latency from 410ms to 320ms", confidence: "low" },
      { id: F(2), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "embedding cache hit rate measured at 45% after rollout", confidence: "low" },
      { id: F(3), projectId: "project.demo", bdId: BD2, agentId: "agent.scout", claim: "throughput plateaus past batch size 48 on the A100", confidence: "low" },
      { id: F(4), projectId: "project.demo", bdId: BD, agentId: "agent.builder", claim: "eval harness flaky on 3 of 220 cases (timeout)", confidence: "low" },
    ])
    .onConflictDoNothing();
  await db
    .insert(learnings)
    .values([
      { id: L(1), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "continuous batching helps tail latency more than mean throughput", appliesTo: ["vllm-deployment", "latency"], confidence: "low" },
      // The high-reuse, evidence-backed learning — the one to click in the provenance view.
      { id: L(2), projectId: "project.demo", bdId: BD2, agentId: "agent.scout", claim: "batch size 32 is the latency/throughput knee for this model", appliesTo: ["vllm-deployment", "latency"], confidence: "medium", nonObviousMarker: "counterintuitive: larger batches past 32 regress p95", evidenceArtifactId: A(1), reuseSuccessCount: 5 },
      { id: L(3), projectId: "project.demo", bdId: BD, agentId: "agent.builder", claim: "warmup requests remove first-call cold start", appliesTo: ["vllm-deployment"], confidence: "low", reuseSuccessCount: 2 },
      { id: L(4), projectId: "project.demo", bdId: BD, agentId: "agent.novice", claim: "logging every token is too verbose for prod", appliesTo: ["observability"], confidence: "low", reuseSuccessCount: 0 },
      // A second evidence-backed learning for provenance depth.
      { id: L(5), projectId: "project.demo", bdId: BD2, agentId: "agent.scout", claim: "speculative decoding adds 1.4x throughput at batch 16", appliesTo: ["vllm-deployment", "throughput"], confidence: "medium", nonObviousMarker: "gains shrink sharply as batch size grows", evidenceArtifactId: A(2), reuseSuccessCount: 3 },
    ])
    .onConflictDoNothing();
  await db
    .insert(checkins)
    .values([
      { id: C(1), bdId: BD, projectId: "project.demo", status: "progress", currentTask: "profiling batch sizes" },
      { id: C(2), bdId: BD2, projectId: "project.demo", status: "complete", currentTask: "benchmark complete" },
      { id: C(3), bdId: BD, projectId: "project.demo", status: "blocked", currentTask: "waiting on GPU quota" },
    ])
    .onConflictDoNothing();

  console.log(`db:seed — demo data ready (project.demo). Operator token: ${OPERATOR_TOKEN}`);
}

run()
  .then(async () => {
    await queryClient.end({ timeout: 5 }); // close the pool so the process exits
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
