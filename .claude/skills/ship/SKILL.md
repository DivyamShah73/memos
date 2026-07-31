---
name: ship
description: The orchestrated build pipeline for a non-trivial MemOS change — reuse scan, plan, tests-first implementation, parallel adversarial review, refutation of every finding, then the machine gates. Use for any feature or fix that touches more than one file or any core invariant.
---

# /ship — the orchestrated build pipeline

One deliberate pipeline for a non-trivial change. The stages exist in this order because each one
removes a class of defect that the next stage would otherwise inherit, and the expensive stages
run last so cheap checks kill bad work early.

Announce which stage you are entering as you go, so the human can follow and interrupt.

---

## Stage 0 — Reuse scan (before anything is written)

Delegate to the **`reuse-scout`** subagent with the task description.

Wait for it. Do not start designing while it runs — its whole value is changing what you build,
and a design formed before you read it will not be revised.

If it reports existing prior art, the default is to use it. Writing new code alongside an existing
helper that does the job requires stating explicitly why the existing one doesn't fit.

## Stage 1 — Plan and get approval

Per CLAUDE.md, the human is the architect and reviewer. Enter plan mode and present:

- what changes, in which files
- which of the five core invariants the change touches (or "none", with a reason)
- the tests that will prove it, named before they're written
- what you are deliberately **not** doing

For anything touching more than one module, the data model, or an invariant, run the
**`design-review`** skill first and fold its output into the plan.

Stop. Wait for approval. Do not proceed on an assumed yes.

## Stage 2 — Tests first

Write the failing test before the implementation. Not as ceremony — a test written afterwards is
shaped by the code that exists, which is exactly why after-the-fact tests pass against wrong
implementations.

Run it. **Watch it fail for the right reason.** A test that fails because of a typo or a missing
import has proven nothing. If it passes before you've implemented anything, the test is wrong.

For invariant work, follow the existing patterns — `packages/api/src/intents/evidence-gate.test.ts`
and the colocated `*.test.ts` files are the house style.

## Stage 3 — Implement

Smallest change that makes the test pass and reads like the code around it. Match the surrounding
comment density and naming — a correct change in a foreign idiom still costs the next reader.

The `Stop` hook enforces a diff budget (~150 added lines / 8 files). If you're heading past it,
that is information: either the change genuinely needs justifying, or it wants splitting.

## Stage 4 — Parallel adversarial review

Launch these three subagents **concurrently in a single message** — they are independent, and
running them in sequence wastes wall-clock for no benefit:

| Subagent | Lens |
|---|---|
| `altitude-critic` | Is this bigger or more abstract than the problem? |
| `test-adversary` | Would these tests pass against a wrong implementation? |
| `invariant-auditor` | Do all five core invariants still hold, in schema *and* handler, with tests? |

None of them can edit — that is deliberate. They report; you fix.

## Stage 5 — Refute every finding

Do **not** act on stage 4 output directly. Critics generate plausible findings, and plausible is
not true; acting on false findings burns effort and trains the human to skim your reports.

For each finding, launch a **`refuter`** subagent (concurrently — one per finding). It is biased
toward REFUTED and must produce a concrete failing case to confirm.

- **CONFIRMED** → fix it.
- **REFUTED** → drop it, and record the one-line reason in your summary.

Report the counts. "9 findings, 3 survived refutation" is a much more honest artifact than nine
findings presented as nine problems.

## Stage 6 — Machine gates

Run the **`gate`** skill. No model judgment at this stage — either the commands pass or they don't.
Do not proceed while anything is red, and do not describe a red gate as "mostly passing".

## Stage 7 — Record

- Append a paragraph to `docs/JOURNAL.md` in the existing house style: what was built, why, and
  what it gated on.
- If a real architectural choice was made, write an ADR via the **`write-adr`** skill.
- Update `docs/API.md` if an intent was added or changed.

## Stage 8 — Commit (ask first)

Propose the conventional-commit message and **ask before committing**. Small and focused, one
logical chunk per commit. Never push without being asked.

---

## Skipping stages

Stages 0, 4, 5 and 6 are the ones that catch what review misses, and they are the ones most
tempting to skip under time pressure. If you skip any stage, say which and why in your summary —
a silent skip turns this pipeline into a description of work that didn't happen.
