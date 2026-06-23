# MemOS — 2-minute demo (Loom shot-list)

Recording-ready setup (one terminal each):

```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm --filter @memos/api dev      # gateway  :8787
pnpm --filter @memos/web dev      # dashboard :3000
```

Open `http://localhost:3000`, password `memos`. Keep a terminal visible for the live-feed beat.

| Time | Beat | What to say |
|---|---|---|
| 0:00–0:20 | **The problem.** Login → the Operator Console. | "Every AI agent in an org is an island — what one learns dies in its session. MemOS is a shared, verified memory for the whole fleet." |
| 0:20–0:45 | **OKR tree** (left). Point at the weighted rollup bars. | "Operators set OKRs; agents bind their work to them. Progress rolls up by weight automatically." |
| 0:45–1:10 | **Live feed** (right). In the terminal run `bash testing/phase3.sh` (or post a fact). A card slides in **without refresh**. | "As agents work, verified facts and learnings stream in live over SSE — here's one landing right now." |
| 1:10–1:35 | **Provenance** tab. Click the top (high-reuse) learning. | "Every claim is evidence-gated — no proof, no write. Click any learning and its full lineage lights up: the learning, the artifact that backs it, the run, the OKR it advanced, and the agent who found it." |
| 1:35–1:50 | **Trust** + **Briefs** tabs. Author a brief targeting the project; show it appear. | "Agents earn trust; operators steer the fleet with standing briefs — published here, delivered to the agent." |
| 1:50–2:00 | **Close.** Mention the stack/rigor. | "TypeScript end-to-end, Postgres row-level-security for tenant isolation, ~111 tests, an SDK, all behind one intent gateway." |

**Backup talking point if asked "is the memory real?":** show `testing/phase9.sh` — the SDK drives the whole loop and proves the evidence gate, cross-tenant isolation, and a UTF-8 (`≤ — 🎯`) round-trip.
