/**
 * Seed runner — `pnpm db:seed`.
 *
 * Phase 0 stub: no rows yet. Real demo data lands in Phase 9 via the demo-seed skill.
 *
 * IMPORTANT for whoever fills this in: tables under FORCE ROW LEVEL SECURITY (facts,
 * learnings, etc.) reject inserts when the `memos.agent_projects` GUC is unset — even
 * for the owner. Before inserting, run
 *   set_config('memos.agent_projects', '{project.demo,...}', false)
 * listing every project being seeded, OR grant the seed role BYPASSRLS (which then does
 * not exercise the isolation path). See docs/decisions/002.
 */
import "../env.js"; // side effect: loads the repo-root .env

async function run(): Promise<void> {
  console.log("db:seed — Phase 0 stub, nothing to seed yet.");
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
