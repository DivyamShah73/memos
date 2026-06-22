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
const O = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const M = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`;
const F = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;
const L = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;
const C = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;

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
    ])
    .onConflictDoNothing();

  await db
    .insert(milestones)
    .values([
      { id: M(1), objectiveId: O(2), projectId: "project.demo", title: "p95 latency <= 200ms", metricTarget: "200", metricCurrent: "320", metricUnit: "ms", metricDirection: "down", status: "pending" },
      { id: M(2), objectiveId: O(3), projectId: "project.demo", title: "cache hit rate >= 90%", metricTarget: "90", metricCurrent: "45", metricUnit: "percent", metricDirection: "up", status: "pending" },
    ])
    .onConflictDoNothing();

  // Recent activity for the live feed.
  await db
    .insert(facts)
    .values([
      { id: F(1), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "vLLM batching cut p95 latency from 410ms to 320ms", confidence: "low" },
      { id: F(2), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "embedding cache hit rate measured at 45% after rollout", confidence: "low" },
    ])
    .onConflictDoNothing();
  await db
    .insert(learnings)
    .values([
      { id: L(1), projectId: "project.demo", bdId: BD, agentId: "agent.operator", claim: "continuous batching helps tail latency more than mean throughput", appliesTo: ["vllm-deployment", "latency"], confidence: "low" },
    ])
    .onConflictDoNothing();
  await db
    .insert(checkins)
    .values([{ id: C(1), bdId: BD, projectId: "project.demo", status: "progress", currentTask: "profiling batch sizes" }])
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
