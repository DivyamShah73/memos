# 014. Agent harness: enforce process invariants with hooks, not instructions

- **Status:** accepted
- **Date:** 2026-07-31
- **Deciders:** Divyam Shah

## Context

This repo is built almost entirely by AI coding agents under human direction, and `CLAUDE.md` states
the rules they work under: plan first, one intent per file, test the invariants, schema-as-code,
conventional commits, ADRs for real decisions.

Those rules were being followed *most of the time*, which is the problem. `CLAUDE.md` is an input to
the model — it competes with everything else in context, may not survive compaction, and can be
reasoned around under time pressure. The failures were consistent and predictable:

- A core-invariant file (`_evidence.ts`, an RLS migration, `core/scope.ts`) edited with no
  corresponding test change. Code compiles, suite is green, the gate it used to enforce is gone.
- "Done, tests pass" reported without the suite having been run in that session.
- 80 lines produced where 12 would do; a helper reinvented that `_fts.ts` already had; an
  abstraction with exactly one call site.
- Review subagents told to "report, don't fix" editing the tree anyway, destroying the record of
  what was wrong.
- A `.env` value read for context and then written as a literal into source.

Every one of these is a *process* invariant, and the product already demonstrates the right answer
for *data* invariants: the evidence gate is enforced in the Zod schema, re-asserted in the handler,
and tenant isolation lives in Postgres RLS with `FORCE` (ADR 002) specifically so that a bug in a
handler cannot leak across tenants. Trust by construction, not by intent.

Phase 2 raises the stakes: an issue→PR pipeline runs an agent **unattended**, on a runner, with a
checkout and a token, against an issue body that any stranger can write. There is no human in the
loop to notice it going sideways.

## Decision

Adopt a five-rung **enforcement ladder**, and treat "which rung does this rule live on" as an
explicit design decision rather than an accident:

| Ring | Mechanism | Guarantee |
|---|---|---|
| 1 | `CLAUDE.md` / `AGENTS.md` | Suggestion |
| 2 | `.claude/skills/` | Procedure, on demand |
| 3 | `.claude/agents/` with restricted `tools:` | Structural — a reviewer with no `Edit` *cannot* edit |
| 4 | `.claude/hooks/` | Deterministic, outside the model's context |
| 5 | `.github/workflows/` | Machine-verified on the artifact |

Concretely:

- **Ring 4 — six Node hooks.** `guard-write.mjs` denies writes to `.claude/hooks/**`,
  `.claude/agents/**`, `.claude/settings.json`, `.github/workflows/**`. `guard-bash.mjs` denies
  irreversible commands, credential reads, **and shell writes to those same protected paths**.
  `scan-secrets.mjs` blocks a post-write credential. `gate-turn.mjs` runs three end-of-turn gates
  (`invariant-without-test`, `claim-without-evidence`, `diff-budget`). `session-brief.mjs` injects
  branch/dirty-tree/journal state at `SessionStart`.
- **Ring 3 — five subagents,** critics with no `Edit`/`Write`, plus a `refuter` that every finding
  must survive before it reaches the human.
- **Ring 5 — two workflows.** `agent-issue-to-pr.yml` splits triage (read-only, can decide the issue
  isn't buildable) from build (writes, gated on triage's verdict), with draft-on-red.
  `agent-pr-review.yml` reviews agent-authored PRs — the builder never reviews itself.

Three load-bearing details:

**Hooks are Node, not shell.** The same files must run on a Windows dev box and on
`ubuntu-latest`. One guardrail definition, two execution contexts — the CI agent is constrained by
the identical file, not a reimplementation that can drift.

**`guard-bash.mjs` closes the hole in `guard-write.mjs`.** `PreToolUse(Edit|Write)` never fires for
`echo > .claude/hooks/gate-turn.mjs`. An agent denied a tool reaches for the shell, and the CI triage
job is exactly that shape (Bash allowed, Edit/Write denied). Without the shell rule the write guard
is decorative. Matching requires the protected path to be the *target* of a write, so reading the
harness stays legal — a guard with a bad false-positive rate gets switched off, and a switched-off
guard is worth less than none.

**Hooks fail open, and the `Stop` hook cannot deadlock.** A hook that crashed on a malformed payload
would deny every subsequent tool call in the session, so all of them tolerate junk input and exit 0
on internal error; the ledger is best-effort and the deny rules are the load-bearing part. `Stop`
blocks are keyed by `(prompt_id, gate)` so each gate fires at most once per turn, with
`stop_hook_active` as a second belt.

## Alternatives considered

- **Put it all in `CLAUDE.md` (ring 1 only).** Rejected: this is the status quo that produced the
  failures above. The decisive case is the self-modification guard — an instruction not to edit your
  own guardrails is addressed to precisely the agent you don't trust to honour it.
- **Rely on the `permissions.deny` list alone.** Rejected: it matches command prefixes, so
  `cd /tmp && rm -rf x` and `rm -fr` both walk past `Bash(rm -rf:*)`, and a denial carries no reason
  the model can act on. Kept underneath the hooks as a coarser second layer (same defense-in-depth
  shape as `_evidence.ts` re-asserting the Zod gate).
- **Adopt an existing large harness (e.g. ECC: 67 agents, 281 skills, 94 commands).** Rejected:
  coverage isn't the constraint, and a component nobody in this repo can explain is a liability in
  review. Every piece here names the failure mode it exists for.
- **A third-party multi-agent orchestration runtime.** Rejected: restricted subagents plus the `ship`
  skill already give the fan-out, and an external runtime adds a dependency and an execution model to
  defend for no additional guarantee.
- **Enforce the diff budget in CI only.** Rejected: a budget discovered at PR time has already cost
  the work. The `Stop` hook surfaces it while the context to cut it down is still live. CI keeps a
  stricter copy (200/10) as a backstop.
- **Post-hoc lint/review instead of pre-write denial.** Rejected for the self-modification and
  credential cases specifically: once a guardrail edit or a secret is committed, the damage is
  historical. Those two want prevention; the rest are fine as detection.

## Consequences

**Good**

- The five product invariants can no longer rot silently — an invariant edit without a test cannot
  end a turn.
- "Done" now costs a test run, in exactly the way a medium-confidence fact costs an artifact.
- Reinvention and over-generation are caught by a named agent and a number, not by whether the
  reviewer happened to notice.
- Findings reaching the human are refuted first, and the refuted list is published, so the confirmed
  ones can be calibrated.
- The CI agent inherits the identical guards, so the unattended path is the constrained path.
- The guards are themselves tested (`testing/harness_hooks.sh`, 46 assertions, ~2s, no
  infrastructure), so a regex typo can't quietly turn a guard into a no-op.

**Costs, accepted**

- **Per-turn latency.** Four hook processes on the hot path (two `PreToolUse`, one `PostToolUse`, one
  `Stop`). Node start-up dominates; measured in tens of milliseconds, and worth it.
- **False blocks.** The diff budget trips on legitimate large mechanical changes. Mitigated by
  letting justification satisfy the gate rather than only cutting, and by the one-block-per-turn key.
- **Bootstrap ordering.** `guard-write.mjs` denies writes to `.claude/**`, so the harness must be
  built with hook registration last or it locks out its own construction. Changing a hook afterwards
  is a human edit — intended, and documented in `docs/HARNESS.md`.
- **Ledger is per-session and gitignored.** `.claude/.state/` state is disposable; a lost ledger
  degrades the `Stop` gates to no-ops rather than failing loudly. Accepted because failing closed on
  a guard is the worse outcome.
- **Known gaps, documented rather than hidden** (`docs/HARNESS.md`): no `lint` script exists anywhere
  in the workspace despite `CLAUDE.md` requiring it, so gate 5 reports `SKIPPED` and never `PASS`;
  `claim-without-evidence` records intent rather than exit code because `PreToolUse` precedes
  execution; and nothing asserts that a future `claude-code-action` version still honours project
  hooks.

## Follow-ups

1. Move `claim-without-evidence` to `PostToolUse` so it reads the suite's exit code.
2. Add ESLint + a `lint` script per package, closing the gate-5 gap.
3. Point `session-brief.mjs` at `learning.query` instead of `docs/JOURNAL.md`, with graceful
   degradation when the API isn't up — the harness asking the product what the fleet already knows.
