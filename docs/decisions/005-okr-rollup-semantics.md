# 005. OKR progress + rollup semantics

- **Status:** accepted
- **Date:** 2026-06-22
- **Deciders:** Divyam Shah

## Context

Phase 5 makes OKRs queryable with a single `progress` number in `[0,1]` per objective and per key result. The data model (`objectives` + `milestones`, one table two roles) supports sub-OKRs (`parent_id` + `weight`), key results (a milestone with `metric_target`/`metric_current`/`metric_direction`), and plain milestones (no metric). Several modeling choices have no single obviously-correct answer — how a "lower is better" metric scores without a recorded baseline, how a partly-abandoned tree rolls up, how an explicitly-achieved item interacts with its metric. These need to be pinned so the math lives in one place (`packages/api/src/intents/_okr.ts`) and the handlers + tests can't drift.

## Decision

All progress is a float in `[0,1]`, computed in `_okr.ts` (pure functions; `numeric` columns arrive as **strings** from postgres-js, so every value is `Number()`'d there).

**Key result / milestone progress (`krProgress`):**
- An `achieved` milestone is `1` — explicit achievement overrides any metric.
- A KR (`metric_target` set), pending: `up` → `current/target`; `down` → `target/current`; both `clamp[0,1]`, div-by-zero guarded (`down` with `current ≤ target` → `1`).
- A plain pending milestone (no `metric_target`) is `0`.

**Objective progress (`objectiveProgress`, recursive):**
- An `achieved` objective is `1`.
- With sub-OKRs: weighted mean of children — `Σ(weightᵢ · progressᵢ) / Σ weightᵢ`, default `weight = 1`, all-zero weights → equal mean. **Abandoned/superseded children are excluded** from both numerator and denominator (a dead branch neither helps nor drags the parent).
- A leaf objective: equal-weighted mean of its milestones' `krProgress`.
- A leaf with no milestones and not achieved is `0`.

**Down-direction without a baseline** is the `target/current` ratio clamp (chosen over adding a `metric_baseline` column + migration): it needs no extra input, matches the build-plan example (current 45 / target 90 → ~0.5 for `up`; current 100 / target 50 → 0.5 for `down`), and is monotonic toward the target. Its limitation — it doesn't know the journey's start, so "reduce from 100 to 50" and "reduce from 60 to 50" score the same at `current=100` vs `current=60` only by ratio — is acceptable for a progress signal; a baseline-relative model is a future enhancement if precision is needed.

**`key_result.update` does not auto-achieve** a KR that reaches `progress = 1`. Achievement is a separate, evidence-gated act (`milestone.achieve`), so hitting a number never silently asserts an unverified "done."

## Alternatives considered

- **Add a `metric_baseline` column** for down-direction (and up) progress. Rejected for Phase 5: needs a migration + every caller to supply a start value; the ratio clamp covers the demo and the common case. Revisit if reporting needs start-relative accuracy.
- **Count abandoned children as `0`** in the rollup (keep them in the denominator). Rejected: abandoning a sub-OKR would *lower* the parent, punishing a deliberate descope. Excluding them treats the parent as "the live children's weighted progress."
- **Auto-achieve a KR at 100%.** Rejected: it would bypass the evidence gate (invariant #1) — a metric bump is not proof.

## Consequences

- **Positive:** one source of truth for the math; deterministic, unit-testable with exact expected values; achievement and measurement stay cleanly separated (the gate holds); a descoped branch doesn't corrupt the rollup.
- **Negative / tradeoffs:** down-direction progress is coarse without a baseline (documented). `progress` is computed on read (and on the achieve/kr-update responses) by re-reading the project's objectives + milestones — fine at OKR-tree scale; if trees grow huge, cache or materialize. Equal-weighting a leaf's milestones means a trivial milestone counts as much as a hard KR unless modeled as weighted sub-OKRs instead.
