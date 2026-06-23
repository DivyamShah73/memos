/**
 * Full end-to-end loop driven by the SDK against a live gateway (run by testing/phase9.sh).
 * Exercises the whole agent lifecycle, then proves the three core invariants:
 *   (a) the evidence gate rejects an unbacked medium write,
 *   (b) tenant isolation hides another project's data,
 *   (c) UTF-8 (`≤ — 🎯`) round-trips intact.
 * Env: MEMOS_API_URL, CODE_A (project.demo), CODE_B (project.other).
 */
import { MemosClient, MemosError } from "../src/index.js";

const API = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
const CODE_A = process.env.CODE_A ?? "";
const CODE_B = process.env.CODE_B ?? "";
const PROJ_A = "project.demo";
const PROJ_B = "project.other";

let fails = 0;
const pass = (m: string) => console.log(`PASS: ${m}`);
const fail = (m: string) => {
  console.log(`FAIL: ${m}`);
  fails++;
};
const b64 = (s: string) => Buffer.from(s).toString("base64");

async function main(): Promise<void> {
  // 1. Enroll.
  const { client: a } = await MemosClient.enroll(API, CODE_A, "e2e-agent-a");
  pass("enrolled agent A");

  // 2. Briefs.
  const briefs = await a.briefFetch({ project_id: PROJ_A });
  pass(`brief.fetch ok (${briefs.briefs.length} briefs, ${briefs.active_okrs.length} okrs)`);

  // 3. Workflow + checkin + artifact.
  const { bd_id } = await a.workflowCreate({
    project_id: PROJ_A,
    workflow_class: "investigation",
    title: "SDK e2e run",
  });
  await a.checkin({ project_id: PROJ_A, bd_id, status: "start", current_task: "investigating" });
  const art = await a.artifactUpload({
    project_id: PROJ_A,
    bd_id,
    kind: "benchmark",
    mime_type: "text/plain",
    content_base64: b64("p99=180ms after warmup"),
  });
  pass(`workflow + checkin + artifact (${bd_id})`);

  // 4. Evidence-gated writes + query-back.
  await a.factRecord({
    project_id: PROJ_A,
    bd_id,
    facts: [{ claim: "p99 latency dropped to 180ms after warmup", confidence: "medium", evidence_artifact_id: art.artifact_id }],
  });
  await a.learningRecord({
    project_id: PROJ_A,
    bd_id,
    learnings: [{ claim: "warmup requests cut cold-start tail latency", applies_to: ["vllm-deployment"], confidence: "medium", non_obvious_marker: "counterintuitive: helps the tail, not the mean", evidence_artifact_id: art.artifact_id }],
  });
  const fq = await a.factQuery({ project_id: PROJ_A, query: "latency" });
  fq.facts.some((f) => /180ms/.test(String(f.claim))) ? pass("evidence-backed fact recorded + queried back") : fail("fact.query");
  const lq = await a.learningQuery({ project_id: PROJ_A, query: "warmup" });
  lq.learnings.length > 0 ? pass("evidence+marker learning recorded + queried back") : fail("learning.query");

  // 5. OKRs: publish → move KR → achieve.
  const obj = await a.objectivePublish({
    project_id: PROJ_A,
    bd_id,
    title: "Cut p99",
    milestones: [{ title: "p99 <= 200ms", metric_target: 200, metric_current: 400, metric_direction: "down" }],
  });
  const ms = obj.milestone_ids[0];
  const kr = await a.keyResultUpdate({ project_id: PROJ_A, milestone_id: ms, metric_current: 200 });
  kr.progress === 1 ? pass("key_result.update → progress 1") : fail(`key_result.update progress=${kr.progress}`);
  const ach = await a.milestoneAchieve({ project_id: PROJ_A, bd_id, milestone_id: ms, claim: "p99 at 200ms", confidence: "medium", evidence_artifact_id: art.artifact_id });
  ach.status === "achieved" ? pass("milestone.achieve (evidence-backed)") : fail("milestone.achieve");

  await a.checkin({ project_id: PROJ_A, bd_id, status: "complete", current_task: "done" });
  pass("workflow closed");

  // --- Invariant proofs ---

  // (a) Evidence gate: a medium fact with no evidence must be rejected. Use a FRESH OPEN run so
  // we're testing the gate (validation_error) — not the closed-run guard on the loop's bd_id.
  const gateRun = await a.workflowCreate({ project_id: PROJ_A, workflow_class: "investigation", title: "gate run" });
  try {
    await a.factRecord({ project_id: PROJ_A, bd_id: gateRun.bd_id, facts: [{ claim: "unbacked", confidence: "medium" }] });
    fail("evidence gate did NOT reject an unbacked medium write");
  } catch (e) {
    e instanceof MemosError && e.errorType === "validation_error"
      ? pass("evidence gate rejected unbacked medium write")
      : fail(`evidence gate: wrong rejection (${e instanceof MemosError ? `${e.errorType}: ${e.message}` : e})`);
  }

  // (b) Tenant isolation: agent B (project.other) can't read A's project, and sees none of A's data.
  const { client: bAgent } = await MemosClient.enroll(API, CODE_B, "e2e-agent-b");
  try {
    await bAgent.factQuery({ project_id: PROJ_A, query: "latency" });
    fail("tenant isolation: B queried A's project without 403");
  } catch (e) {
    e instanceof MemosError && e.errorType === "forbidden" ? pass("tenant isolation: B is 403 on A's project") : fail(`unexpected: ${e}`);
  }
  // B writes a distinctive fact in its OWN project, then queries: it must see its fact and never A's.
  // (Non-vacuous: asserts B's query returns its scoped data, not an empty set that passes trivially.)
  const bRun = await bAgent.workflowCreate({ project_id: PROJ_B, workflow_class: "investigation", title: "B run" });
  await bAgent.factRecord({ project_id: PROJ_B, bd_id: bRun.bd_id, facts: [{ claim: "tenant-B-only marker fact", confidence: "low" }] });
  const bOwn = await bAgent.factQuery({ project_id: PROJ_B, query: "marker" });
  const seesOwn = bOwn.facts.some((f) => /tenant-B-only/.test(String(f.claim)));
  const seesA = bOwn.facts.some((f) => /180ms/.test(String(f.claim)));
  seesOwn && !seesA
    ? pass("tenant isolation: B sees its own project's facts, none of A's")
    : fail(`tenant isolation (seesOwn=${seesOwn} seesA=${seesA})`);

  // (c) UTF-8 round-trip. (The first run is closed, so open a fresh one for this write.)
  const utf = "throughput ≤ 200ms — cost 🎯 hit";
  const utfRun = await a.workflowCreate({ project_id: PROJ_A, workflow_class: "investigation", title: "utf run" });
  await a.factRecord({ project_id: PROJ_A, bd_id: utfRun.bd_id, facts: [{ claim: utf, confidence: "low" }] });
  const utfq = await a.factQuery({ project_id: PROJ_A, query: "throughput" });
  const got = utfq.facts.find((f) => /throughput/.test(String(f.claim)));
  got && String(got.claim).includes("≤") && String(got.claim).includes("—") && String(got.claim).includes("🎯")
    ? pass("UTF-8 round-trip intact (≤ — 🎯)")
    : fail(`UTF-8 round-trip (got: ${got?.claim})`);
}

main()
  .then(() => {
    console.log(fails === 0 ? "ALL SDK E2E CHECKS PASS" : `${fails} CHECK(S) FAILED`);
    process.exit(fails === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("SDK e2e crashed:", err);
    process.exit(1);
  });
