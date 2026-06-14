# MemOS — Phased Build Plan (2 days, test-gated)

> The rule: **you do not start a phase until the previous phase's exit gate is GREEN.** A gate is green only when (a) automated tests pass AND (b) you've personally run the manual test and seen it work. No exceptions — this is what keeps "what's broken?" answerable at all times.
>
> Each phase below has: **Build** (what to make), **Automated test** (what Claude writes + runs), **Manual test** (what YOU run/click), and **Exit gate** (the checkbox criteria). Manual tests use a curl script per phase so you can re-run the whole suite anytime.

---

## How to run this

- Give Claude **one phase at a time**. Start each with: *"We're on Phase N. Read CLAUDE.md + docs/PROJECT_DOC.md. Plan Phase N, then build it. Write its tests AND a `testing/phaseN.sh` manual-test script."*
- After build: run `pnpm test` (automated) → then run `bash testing/phaseN.sh` (manual) yourself → eyeball the output against the **Expect** column.
- Only when both are green do you check the box and say "Phase N+1."
- Keep a running `testing/smoke_all.sh` that chains every phase script — re-run it after each phase to catch regressions in earlier phases.

**Convention for manual tests:** every `phaseN.sh` prints a clear `PASS:`/`FAIL:` line per check so you're not parsing raw JSON. Have Claude build that in.

---

# DAY 1 — Backend, end to end (Phases 0–5)

## Phase 0 — Repo + infra skeleton
**Build:**
- Monorepo scaffold (`packages/api`, `web`, `workers`, `shared`; `infra/`, `sdk/`, `docs/`).
- `docker-compose.yml`: Postgres + MinIO + Redis. `pnpm`, TypeScript, Vitest configured.
- Drizzle schema for the **full** data model (DATA_MODEL.md), first migration.
- ADRs `001-intent-rpc` and `002-rls-multitenancy`.

**Automated test:** none yet (no logic) — but `pnpm typecheck` must pass and `pnpm db:migrate` must apply cleanly.

**Manual test (`testing/phase0.sh`):**
```bash
docker compose up -d
pnpm db:migrate
# connect and list tables
docker compose exec -T db psql -U postgres -c "\dt"
```
**Expect:** all tables from DATA_MODEL.md exist (agents, projects, objectives, milestones, workflow_runs, checkins, facts, learnings, artifacts, briefs, ...). MinIO console reachable at localhost:9001.

**EXIT GATE — check only when:**
- [ ] `docker compose up` brings up Postgres + MinIO + Redis
- [ ] `pnpm db:migrate` applies with no error
- [ ] every table exists (you saw them in `\dt`)
- [ ] `pnpm typecheck` clean

---

## Phase 1 — Gateway core + auth + enrollment
**Build:**
- Single route `POST /v1/intent/{name}`, the dispatch registry, the uniform envelope.
- Zod validation → `400` + `field_errors`. Bearer-auth middleware. Per-token rate limit stub.
- `agent.enroll` (code → hashed token), `enrollment_codes` consumed on use.

**Automated test:** `agent.enroll` happy path; enroll with a used/invalid code → rejected; a call with no token to an authed intent → 401; malformed body → 400 with field_errors.

**Manual test (`testing/phase1.sh`):**
```bash
API=http://localhost:8787
# 1. enroll with a seeded code
TOK=$(curl -s -X POST $API/v1/intent/agent.enroll \
  -H 'content-type: application/json' \
  -d '{"code":"enr_code_test","display_name":"tester"}' | jq -r '.data.api_token.raw')
echo "token: $TOK"
# 2. reuse the same code → should fail
curl -s -X POST $API/v1/intent/agent.enroll -H 'content-type: application/json' \
  -d '{"code":"enr_code_test","display_name":"x"}' | jq '.ok'   # expect false
# 3. authed call with no token → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/v1/intent/workflow.create -d '{}'  # expect 401
```
**Expect:** step 1 prints a real `syn_...`; step 2 prints `false`; step 3 prints `401`.

**EXIT GATE:**
- [ ] enroll returns a token shown once; DB stores only a hash (verify the column isn't the raw token)
- [ ] reused/invalid code rejected
- [ ] no-token authed call → 401; bad body → 400 with `field_errors`
- [ ] automated tests green

---

## Phase 2 — Workflow + checkin (the provenance spine)
**Build:** `workflow.create` (→ `bd_id`), `checkin` (start/progress/blocked/complete/failed). Enforce: on `okrs_required` projects, `workflow.create` needs a non-abandoned `target_objective_id`.

**Automated test:** create→checkin start→checkin complete happy path; create on okrs_required project with no objective → rejected; create binding an abandoned objective → rejected ("cannot bind"); checkin on unknown bd_id → rejected.

**Manual test (`testing/phase2.sh`):** open a workflow, fire start + complete checkins, query the run's state.
```bash
BD=$(curl -s -X POST $API/v1/intent/workflow.create -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","workflow_class":"investigation","title":"smoke run","target_objective_id":"<seeded-okr>"}' | jq -r '.data.bd_id')
echo "bd_id: $BD"
curl -s -X POST $API/v1/intent/checkin -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"status\":\"start\",\"current_task\":\"begin\",\"target_objective_id\":\"<seeded-okr>\"}" | jq '.ok'
```
**Expect:** a `bd_id` like `memos-xxxx`; checkin returns `ok:true`.

**EXIT GATE:**
- [ ] workflow opens and returns a bd_id
- [ ] checkins record and the run's status moves
- [ ] abandoned-objective binding is rejected with a clear error
- [ ] automated tests green; `smoke_all.sh` (phases 0–2) green

---

## Phase 3 — Artifacts + evidence-gated writes (THE core invariant)
**Build:** `artifact.upload` (base64 → MinIO, returns id + sha256 + bucket_path). `fact.record` / `learning.record` (arrays). **Enforce the gates in schema + handler:** medium/high needs `evidence_artifact_id`; learnings medium/high also need `non_obvious_marker` (≥15 chars); cited artifact must exist and be same-tenant/same-bd_id.

**Automated test (this is your most important test file):**
- low-confidence fact, no evidence → ACCEPTED
- medium fact, no evidence → REJECTED
- high learning, no non_obvious_marker → REJECTED
- fact citing a non-existent artifact_id → REJECTED
- fact citing an artifact from another project → REJECTED
- full happy path: upload → record medium fact citing it → ACCEPTED

**Manual test (`testing/phase3.sh`):**
```bash
# upload evidence
ART=$(curl -s -X POST $API/v1/intent/artifact.upload -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"kind\":\"log\",\"description\":\"smoke\",\"mime_type\":\"text/plain\",\"content_base64\":\"$(echo 'evidence body' | base64)\"}" | jq -r '.data.artifact_id')
# A) medium fact WITHOUT evidence → must FAIL
curl -s -X POST $API/v1/intent/fact.record -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"x\",\"confidence\":\"medium\"}]}" | jq '{ok, error}'
# B) medium fact WITH evidence → must SUCCEED
curl -s -X POST $API/v1/intent/fact.record -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"project_id\":\"project.demo\",\"bd_id\":\"$BD\",\"facts\":[{\"claim\":\"x\",\"confidence\":\"medium\",\"evidence_artifact_id\":\"$ART\"}]}" | jq '{ok, ids:.data.fact_ids}'
```
**Expect:** A prints `ok:false` with a gate error; B prints `ok:true` with fact ids. **If A succeeds, the product is broken — do not pass this gate.**

**EXIT GATE:**
- [ ] artifact uploads to MinIO; sha256 returned; bytes are NOT in Postgres
- [ ] evidence gate enforced (manual A fails, B succeeds)
- [ ] non-obvious gate enforced for learnings
- [ ] cross-tenant evidence borrowing rejected
- [ ] the invariant test file is green and covers all the above

---

## Phase 4 — Query (find what's stored)
**Build:** `fact.query` / `learning.query` via Postgres full-text search first. (Vector/pgvector is a stretch goal — add only if time; keep FTS as the baseline.)

**Automated test:** record 3 learnings with distinct claims; query a keyword → returns the right ones, not the others; query respects project scope (a query in project A doesn't return project B's rows).

**Manual test (`testing/phase4.sh`):**
```bash
curl -s -X POST $API/v1/intent/learning.query -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","query":"evidence"}' | jq '.data.learnings | length'
```
**Expect:** a non-zero count, and the returned claims are relevant to the query word.

**EXIT GATE:**
- [ ] query returns relevant results by keyword
- [ ] query is project-scoped (cannot see other projects)
- [ ] automated + manual green; `smoke_all.sh` (0–4) green

---

## Phase 5 — OKRs (goals + rollups)
**Build:** `objective.publish` / `objective.query` / `objective.update` (sub-OKRs via parent_id + weight, status incl. abandoned). `milestone.achieve`, `key_result.update` (returns progress). Rollup math (sub-OKR weight × child progress; respect metric_direction down=lower-better).

**Automated test:** publish an objective with milestones; `key_result.update` moves `metric_current` and returns correct `progress`; `milestone.achieve` flips status + stores the achievement snapshot; a down-direction metric computes progress correctly (lower is better).

**Manual test (`testing/phase5.sh`):** publish an OKR, move a KR to 50% of target, achieve a milestone, query the objective and read back progress.
**Expect:** progress reflects the metric (e.g. current 45 / target 90 → ~0.5); achieved milestone shows `status:achieved` + snapshot.

**EXIT GATE:**
- [ ] objectives + sub-OKRs publish and query with full tree
- [ ] KR updates move progress; down-direction handled
- [ ] milestone.achieve records snapshot + flips status
- [ ] abandoned objectives can't be bound (re-verify Phase 2 still holds)
- [ ] automated + manual green

> **End of Day 1 demo:** a curl script runs the ENTIRE agent loop (enroll → workflow → checkin → upload → evidence-gated fact + learning → query → achieve milestone → close), and an evidence-less medium write is rejected. If that script passes end-to-end, Day 1 is truly done.

---

# DAY 2 — Governance, dashboard, end-to-end (Phases 6–9)

## Phase 6 — Briefs, questions, governance worker
**Build:** `brief.fetch` (returns briefs + active_okrs), `brief.ack`, org/team/project/agent targeting, supersede chain. `question.ask` / `question.answer` (answer delivered as a brief). One **critic worker** (evidence-compliance) + the 24h brief-escalation sweep (run on demand for testing).

**Automated test:** an agent fetches only briefs targeting it/its team/project, unacked; ack removes it from the next fetch; superseded briefs don't show; the critic, run against a seeded evidence-less learning, files a brief at the offender; question.ask then answer surfaces as a brief to the asker.

**Manual test (`testing/phase6.sh`):**
```bash
# fetch briefs
curl -s -X POST $API/v1/intent/brief.fetch -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","include_acked":false}' | jq '{briefs:(.data.briefs|length), okrs:(.data.active_okrs|length)}'
# run the critic worker, then re-fetch → a new brief should appear
pnpm --filter workers run critic:evidence
curl -s -X POST $API/v1/intent/brief.fetch -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"project_id":"project.demo","include_acked":false}' | jq '.data.briefs[].title'
```
**Expect:** fetch returns briefs + active_okrs; after running the critic, a new compliance brief appears; acking it removes it next fetch.

**EXIT GATE:**
- [ ] brief.fetch returns correctly-targeted, unacked briefs + active_okrs
- [ ] ack works; supersede chain respected
- [ ] critic worker files a brief at a non-compliant write
- [ ] question → answer round-trips as a brief
- [ ] automated + manual green; `smoke_all.sh` (0–6) green

---

## Phase 7 — Dashboard core (the showpiece, part 1)
**Build:** Next.js + shadcn shell, operator login (Supabase Auth). **OKR tree** with rollup bars (Recharts). **Live activity feed** (Realtime/SSE) showing checkins/facts/learnings. Reads are RLS-filtered.

**Automated test:** Playwright — login renders the dashboard; OKR tree shows seeded objectives with progress bars; posting a fact via API makes it appear in the feed (poll/await).

**Manual test (you, in the browser):**
1. `pnpm --filter web dev` → open localhost:3000, log in.
2. Confirm OKR tree shows objectives with progress bars matching the data.
3. In a second terminal, run `testing/phase3.sh` (records a fact) → **watch it appear live in the feed within a second.**
**Expect:** the feed updates live without a refresh; progress bars match the numbers.

**EXIT GATE:**
- [ ] login works; dashboard renders
- [ ] OKR tree + rollup bars correct against seed data
- [ ] live feed shows a newly-posted fact WITHOUT refresh (you saw it)
- [ ] dashboard reads are project-scoped (can't see other tenants)
- [ ] Playwright green

---

## Phase 8 — Dashboard provenance + governance views (showpiece, part 2)
**Build:** **Provenance graph** (React Flow): learning → artifact → run → OKR → agent, clickable. Trust leaderboard. Brief authoring UI. Token/member management.

**Automated test:** Playwright — clicking a learning expands its provenance chain; the graph renders the expected node types and edges.

**Manual test (browser):** click a seeded high-reuse learning → its full lineage lights up (artifact, run, OKR, agent). Author a brief in the UI → fetch it via `testing/phase6.sh` → it appears for the agent.
**Expect:** the graph is interactive and the chain is correct end-to-end; an operator-authored brief reaches an agent.

**EXIT GATE:**
- [ ] provenance graph renders and is clickable; chain is correct
- [ ] trust leaderboard reflects seed scores
- [ ] operator-authored brief reaches the agent (round-trip)
- [ ] Playwright green

---

## Phase 9 — SDK, seed, full end-to-end + hardening
**Build:** `sdk/memos-agent` client lib + `/agents.md` manifest. `pnpm db:seed` rich demo data (`demo-seed` skill). The full e2e test. UTF-8 round-trip check. README + 2-min Loom.

**Automated test — the full loop via the SDK (Vitest or a script):**
enroll → fetch briefs → ack → create workflow → checkins → upload artifact → record evidence-gated fact + learning → query them back → achieve milestone → update KR → close workflow. Plus: a deliberate evidence-less medium write is rejected. Plus: cross-tenant read returns nothing. Plus: `≤ — 🎯` round-trips intact through a claim.

**Manual test — the "cold start" test (the real proof):**
1. `docker compose down && docker compose up -d && pnpm db:migrate && pnpm db:seed`
2. `bash testing/smoke_all.sh` (every phase script, start to finish)
3. Open the dashboard fresh → everything is populated and live.
**Expect:** from a clean machine, one sequence brings the whole system up green, and the dashboard looks demo-ready.

**EXIT GATE — the project is DONE when:**
- [ ] the full SDK e2e loop passes
- [ ] evidence gate + tenant isolation + UTF-8 all proven in tests
- [ ] `smoke_all.sh` passes from a clean `docker compose up`
- [ ] dashboard is populated, live, and screenshot-ready
- [ ] README + architecture diagram + Loom done

---

## The master regression script (`testing/smoke_all.sh`)

Build this incrementally — append each phase's checks as you go. After EVERY phase, run it top-to-bottom. If an earlier phase's check goes red, you broke something — fix it before continuing. This single script is your "is anything broken?" answer at all times.

```bash
#!/usr/bin/env bash
set -e
echo "=== MemOS smoke suite ==="
bash testing/phase1.sh   # auth + enroll
bash testing/phase2.sh   # workflow + checkin
bash testing/phase3.sh   # evidence gate  ← the critical one
bash testing/phase4.sh   # query
bash testing/phase5.sh   # okrs
bash testing/phase6.sh   # briefs + critic
echo "=== ALL PHASES GREEN ==="
```

---

## Reality check on the 2-day timeline

This is aggressive but doable *because* the spec is fully designed already. To protect the timeline:
- **Phases 0–5 must finish Day 1.** If you're behind, the cut line is **pgvector** (keep FTS) and **the SDK** (agents can use raw curl). Never cut the evidence gate or tenant isolation — those ARE the product.
- **Phase 7's live feed and Phase 8's provenance graph are the demo.** If Day 2 runs short, a polished feed + graph beats five mediocre views. Cut breadth, keep the two showpieces sharp.
- A phase that won't go green by its deadline gets **descoped, not rushed past untested.** A half-built phase with a checked box is exactly the "what's broken?" mess you're avoiding.

> **The discipline that makes this work:** the box gets checked when the manual test passed *in front of you*, not when Claude says it's done. Trust the green, verify the green.
