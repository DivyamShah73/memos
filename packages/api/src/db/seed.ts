/**
 * Seed runner — `pnpm db:seed`.
 *
 * Phase 0 stub: no rows yet. Real demo data lands in Phase 9 via the demo-seed skill.
 *
 * Note on RLS: this runs as the OWNER (DATABASE_URL = the `postgres` superuser), and a
 * superuser bypasses RLS unconditionally — FORCE only binds a non-superuser table-owner
 * (see docs/decisions/002, the Phase-2 correction). So seeding RLS'd tables
 * (facts/learnings/workflow_runs/…) needs NO `memos.agent_projects` GUC. If the owner is
 * ever switched to a non-superuser role, set the GUC before inserting.
 */
import "../env.js"; // side effect: loads the repo-root .env

async function run(): Promise<void> {
  console.log("db:seed — Phase 0 stub, nothing to seed yet.");
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
