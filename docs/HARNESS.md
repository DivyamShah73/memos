# The MemOS Agent Harness

> How this repo is set up to be worked on by AI coding agents, and why each piece exists.
> Companion to `CLAUDE.md` (which states the rules) — this document is about what **enforces** them.

---

## The thesis

An LLM does what you ask it to, most of the time. "Most of the time" is fine for suggestions and
useless for invariants.

So this harness is built on one principle:

> **The things that matter are not enforced by asking. They are enforced by a mechanism outside the
> model's control** — a hook that denies the tool call, or a gate whose exit code decides.

That is deliberately the same argument the product makes. MemOS does not keep its store clean by
asking agents to cite evidence; it enforces the evidence gate in the Zod schema, re-asserts it in
`_evidence.ts`, and isolates tenants with Postgres Row-Level Security so that a bug in a handler
*cannot* leak across projects. Trust comes from construction, not intent.

This harness applies that to the agent building the product. The sharpest expression of it is the
`claim-without-evidence` gate: an agent that edited `packages/*/src` and never ran the suite cannot
end its turn. The product's rule is "no confident claim without evidence you can check." "I
implemented it" is a confident claim. The test run is the evidence.

---

## The enforcement ladder

Five rungs, weakest guarantee to strongest. **The rung a rule lives on is a design decision**, and
the interesting question about any rule is not "is it written down" but "what happens when the model
would rather not."

| Ring | Mechanism | Where | Guarantee | Why you can't stop here |
|---|---|---|---|---|
| 1 | **Context** | `CLAUDE.md`, `AGENTS.md` | Suggestion | The model drifts, compacts it away, or reasons its way around it |
| 2 | **Skills** | `.claude/skills/` | Procedure, on demand | Only runs if invoked; nothing invokes it under time pressure |
| 3 | **Subagents** | `.claude/agents/` | *Structural* — a reviewer with no `Edit` tool cannot edit | Findings can still be confidently wrong |
| 4 | **Hooks** | `.claude/hooks/` | Deterministic, outside the model's context | Guards the process; can't judge the artifact |
| 5 | **CI gates** | `.github/workflows/` | Machine-verified on the artifact | — |

Ring 1 is where most people stop, and it's why "I put it in CLAUDE.md" is not an answer to "how do
you stop the agent doing X."

---

## Ring 4 — Hooks

Six files in `.claude/hooks/`, five enforcements, zero dependencies. Written in Node (`.mjs`)
rather than bash or PowerShell for one reason: **the same files run on a Windows dev box and on the
`ubuntu-latest` runner** that executes the issue→PR pipeline. One guardrail definition, two
execution contexts.

| Hook | Event | Failure mode it addresses |
|---|---|---|
| `guard-write.mjs` | `PreToolUse(Edit\|Write)` | Agent edits its own guardrails when they're inconvenient |
| `guard-bash.mjs` | `PreToolUse(Bash)` | Irreversible commands; credential exfiltration; **writing to protected paths via the shell** |
| `scan-secrets.mjs` | `PostToolUse(Edit\|Write)` | Agent reads `.env` for context, then hardcodes the value into source |
| `gate-turn.mjs` | `Stop` | Untested invariants; claiming done without running anything; over-generation |
| `session-brief.mjs` | `SessionStart` | Cold start — building on top of someone's half-finished change |
| `_lib.mjs` | — | Shared: decision envelopes, path classification, the session ledger |

### The two that matter most

**`guard-write.mjs` — the agent may not modify the mechanism that constrains it.**
Writes to `.claude/hooks/**`, `.claude/agents/**`, `.claude/settings.json`, and
`.github/workflows/**` are denied outright. This is the write an agent reaches for precisely when a
gate is in its way, and no amount of instruction in `CLAUDE.md` can prevent it — an instruction is
addressed to the thing you're trying to constrain.

`guard-bash.mjs` closes the obvious hole in that: **an agent denied the `Write` tool uses
`echo >`.** Since `PreToolUse(Edit|Write)` never fires for a shell redirect, the same protected
paths are enforced against `>`, `>>`, `tee`, `sed -i`, `cp`, and `mv`. Matching requires the
protected path to be the *target* of a write — reading `.claude/settings.json` stays legal, because
a guard with a bad false-positive rate gets switched off, and a switched-off guard is worth less
than no guard at all.

**`gate-turn.mjs` — the end-of-turn gates.** A `PreToolUse` hook sees one call at a time. The
interesting failures are shaped like a *turn*, so each guard appends what it saw to a per-session
**ledger** (`.claude/.state/<session_id>.json`) and the `Stop` hook reasons over the accumulation:

1. **`invariant-without-test`** — an invariant-bearing file changed but no test changed with it.
   `CLAUDE.md` says "every change that touches a core invariant needs a test proving it holds"; this
   is that sentence with teeth. It's the exact shape of silent rot: the code compiles, the suite is
   green, and the gate it used to enforce is gone.
2. **`claim-without-evidence`** — `packages/*/src` changed and the suite never ran. The product's
   evidence gate, aimed at the agent.
3. **`diff-budget`** — more than ~150 added lines or 8 files. Blocks until the diff is cut down *or*
   explicitly justified. Large diffs aren't forbidden; unexamined ones are.

**Loop safety.** A `Stop` hook that blocks unconditionally deadlocks the session. Blocks are keyed
by `(prompt_id, gate)` so each gate fires at most once per turn, and `stop_hook_active` is honoured
as a second belt. Both are tested.

**Failing safe.** Every hook tolerates malformed input and exits 0 on internal error. A hook that
crashed on a bad payload would deny *every subsequent tool call* in the session — failing closed on
a guard is a worse outcome than the guard not running, so the ledger is best-effort and the deny
rules are the load-bearing part.

### The hooks are tested

```bash
bash testing/harness_hooks.sh     # 60 assertions, ~2s, no DB, no network, no tokens
```

The repo's own standard is that an enforcement mechanism needs a test proving it holds. The hooks
*are* enforcement mechanisms, so they get the same treatment as the invariants they guard —
otherwise a typo in one regex silently converts a guard into a no-op and nothing anywhere fails.
The suite asserts denials, the matching **allowed** forms (false-positive control), the Stop-gate
loop protection, and safe behaviour on malformed payloads.

---

## Ring 3 — Subagents: separation of powers

Five agents in `.claude/agents/`. The load-bearing line in each is the `tools:` frontmatter.

| Agent | Tools | Failure mode it kills |
|---|---|---|
| `reuse-scout` | Read, Grep, Glob | **Confident reinvention** — writing a helper that already exists |
| `altitude-critic` | Read, Grep, Glob, Bash | **Over-generation** — the big block that should be a few lines, speculative abstraction, defensive noise, scope creep |
| `test-adversary` | Read, Grep, Glob, Bash | **Tests that don't detect** — names a specific wrong implementation and predicts whether the test catches it |
| `invariant-auditor` | Read, Grep, Glob | **Silent invariant rot** — checks all five, in schema *and* handler, each with a test |
| `refuter` | Read, Grep, Glob | **Plausible-but-wrong findings** — biased toward REFUTED; must produce a concrete failing case to confirm |

**Why the critics have no `Edit`.** Instructing a review agent to "report, don't fix" does not work
— it will helpfully fix things, and the record of what was wrong disappears with the diff. The
restriction has to be structural. This is a lesson from actually running review agents on this
repo, not a theoretical concern.

**Why `refuter` exists.** Critics generate plausible findings, and plausible is not true. A model
will confidently report a race in single-threaded code or a leak in a query an RLS policy already
blocks. Every false finding spends real human attention and teaches the reader to skim the next
report — which is how a review pipeline decays into theatre. So no finding reaches the human
un-refuted, and the output is `"9 findings raised, 3 survived refutation"` with the refuted list
shown. That last part is what lets a reader calibrate how much to trust the confirmed three.

**The composition:** *skill = procedure. agent = actor with restricted powers. hook = law.*
`evidence-gate-check` was already a skill; `invariant-auditor` is the actor that runs it under least
privilege, so an audit can never quietly become a fix.

---

## Rings 1–2 — Context and skills

`CLAUDE.md` holds the product invariants, the working agreement, and the locked tech stack.
`.claude/skills/` holds procedures loaded on demand:

| Skill | Purpose |
|---|---|
| `ship` | **The orchestrator.** reuse scan → plan → tests-first → parallel critic fan-out → refute every finding → machine gates → record |
| `gate` | Machine gates only, as a pass/fail table |
| `design-review`, `write-adr`, `db-migration`, `scaffold-intent`, `evidence-gate-check`, `frontend-component`, `demo-seed` | Pre-existing project procedures |
| `issue-triage`, `issue-build` | The CI stages (below) |

`ship` is where the fan-out happens: the three critics run **concurrently** (independent, so
sequencing them wastes wall-clock), then one `refuter` per finding, also concurrent.

---

## Ring 5 — CI, and the issue→PR pipeline

`ci.yml` and `critic.yml` predate this harness. The two new workflows are the harness pointed at
GitHub.

### `agent-issue-to-pr.yml`

Label an issue `agent:build` (or comment `@claude build`) → a gated PR.

Two jobs with **different privileges**, not one:

- **`triage`** — `contents: read`, `issues: write`. Tool set `Read,Grep,Glob,Bash`; `Edit`/`Write`
  denied. Produces a spec and a machine-readable verdict. **Can decide the issue isn't buildable and
  stop**, which is a success, not a failure.
- **`build`** — `contents: write`, `pull-requests: write`. Only runs `if` triage said `proceed`.

Wiring an agent to a webhook is the easy half. These eight things are the half that matters:

1. **Privileged trigger.** Applying the `agent:build` label requires write access, so the labelling
   *is* the authorisation. The comment path is separately gated on the **commenter's**
   `author_association` — not the issue author's, since anyone can file an issue and then comment on
   it. A stranger cannot start the agent or spend the token budget.
2. **The issue body is untrusted input.** It's attacker-controlled text entering an agent's context.
   Both skills treat it as *data* and are instructed to refuse instructions embedded in it, to never
   echo an env var, and to set `reject` on an injection attempt. `pull_request_target` is never used,
   so untrusted code never runs alongside secrets. Network tools are off in both stages: nothing in
   "implement this issue" needs the web, and leaving them off removes the exfiltration path.
3. **It cannot disarm its own gates.** `.claude/settings.json` is checked out, so the *same hooks*
   load in CI. Path protection is enforced by `guard-write.mjs` + `guard-bash.mjs`, exactly as
   locally.
4. **Draft-on-red.** Any failing gate ⇒ the PR opens as a **draft** with the gate table and a link
   to the run. There is deliberately no path to a green-looking PR over a red build.
5. **Diff budget** (200 lines / 10 files in CI, stricter than local — an unattended agent has nobody
   to talk it down), staged before measuring so a single huge new file can't score `+0`.
6. **`test-adversary`** in review, so tests that pass against a wrong implementation get named.
7. **Bounded cost.** `--max-turns`, job timeouts, and a per-issue `concurrency` group so three
   comments don't start three agents on one branch.
8. **The human is the merge gate.** The agent opens PRs. It never merges.

The PR body carries the triage spec, the gate table, and a **"deliberately not done"** section. That
last one is the most useful part for a reviewer: work that declares its own boundaries can be
checked; work that silently implies completeness cannot.

### Model per stage

Model choice is matched to how much judgment the stage actually needs, rather than defaulting to the
best model everywhere. Set via `claude_args: --model`, with subagents carrying `model:` in their own
frontmatter.

| Stage | Model | Turn cap | Why |
|---|---|---|---|
| `triage` | Sonnet | 12 | Read, grep, summarise, decide buildability. Comprehension, not design judgment — and it runs on every labelled issue, including the ones it rejects. |
| `build` | **Opus** | 40 | Chooses how to satisfy an invariant, whether a test would catch a wrong implementation, and what the minimal diff is. Unattended, with write access, and the only stage whose mistakes reach a PR. |
| review orchestrator | Sonnet | 30 | Fan-out and synthesis |
| `altitude-critic`, `test-adversary`, `invariant-auditor` | Sonnet | — | Each matches a diff against a *named* list of failure modes. Pattern work; three cheap independent lenses beat one expensive pass. |
| `refuter` | Sonnet | — | One narrow question: can this finding be destroyed? |

Roughly 40% of all-Opus cost. The defensible version of this decision is not "I used the best model" —
it's **"Opus only where judgment lives, and I can name what judgment each stage exercises."**

### `agent-pr-review.yml`

Runs on `agent-authored` PRs. **The agent that wrote the code does not review it** — a builder
reviewing its own diff rationalises rather than reviews. Fans out the three critics, refutes every
finding, posts one comment. `pull_request` (never `pull_request_target`), read-only token plus
`pull-requests: write` for the comment. Findings advise the human; the mechanical bar is the gates.

---

## Ring 3½ — the critics have regression tests

The hooks had a test suite from the start. The subagents did not, and they are the least stable
artifact in the harness, because they are **prompts**. Change one sentence in `test-adversary.md` and
it can silently stop catching fake tests — nothing fails, no gate goes red, and you find out months
later. That is the same failure this whole repo argues against, applied to the critics themselves.

```bash
node testing/agent-evals/run.mjs        # 6 fixtures, ~8 min, ~$0.60
```

Each fixture plants a known defect in an **isolated git worktree** and runs the *real* subagent
against it via `claude -p`, so the actual `.claude/agents/` definition is exercised rather than a copy
of its prompt:

| Fixture | Planted defect | Must be caught by |
|---|---|---|
| 01 | A helper duplicating `_fts.ts` | `altitude-critic` |
| 02 | A test asserting a hand-built literal, never calling the handler | `test-adversary` |
| 03 | Evidence gate weakened from `!== "low"` to `=== "high"`, no test | `invariant-auditor` |
| 04 | A factory + strategy interface with one call site | `altitude-critic` |
| 05 | **A docs-only change** | **nobody — must report no findings** |
| 06 | A request for something `_fts.ts` already does | `reuse-scout` (works from a task, not a diff) |

Five of the five subagents have coverage. `refuter` does not, because its input is another agent's
finding rather than a diff — evaluating it properly needs a fixture pair (a true finding it must
confirm, a false one it must destroy), which is the obvious next addition.

Fixture 05 is the one that matters. A critic that flags everything is as useless as one that flags
nothing, so **false-positive rate is measured, not assumed** — the same reasoning as
`harness_hooks.sh` asserting the *allowed* command forms alongside the denials.

**Two of the first attempts at that control had real defects the critics caught.** The first landed a
helper with zero call sites; `altitude-critic` correctly called it scope-without-effect. The second
was a test that couldn't run — `test-adversary` traced a wrong helper signature all the way to the
`TypeError` in `beforeAll` and cited the real line numbers. The fixtures were wrong, not the critics,
which is the most reassuring possible result from an eval suite.

Known limitation, stated rather than hidden: assertions are keyword-based over the agent's prose.
Weaker than a structured verdict; the honest fix is to make the critics emit JSON. It still catches
the failure that matters — a critic that stops reporting the defect at all.

## Does any of this actually fire?

```bash
node scripts/harness-report.mjs            # terminal
node scripts/harness-report.mjs --html     # also writes harness-report.html
```

"Is your enforcement layer theatre?" is the fairest question anyone can ask, and it deserves a number.
The report reads three real sources — no separate instrumentation to drift:

- **Authorship provenance** from git trailers: what share of commits an agent co-authored. The same
  idea MemOS is built on (every fact carries its provenance), applied to the repo itself — so
  "do agent-authored commits get reverted more often?" becomes answerable later rather than a vibe.
- **Hook enforcement activity** from the per-session ledgers the hooks already write. Block counts are
  a *by-product of the guards running*, which is why they can't drift from the guards.
- **Pipeline history** from the GitHub API, with duration and cost per run (cached in `.harness/`,
  since cost only appears inside the run log).

## Known gaps

Listed because a harness that hides its gaps is making exactly the claim-without-evidence mistake it
exists to prevent.

- ~~**No lint.**~~ **Closed.** `pnpm lint` was `pnpm -r --if-present run lint` with no package
  defining a `lint` script, so it exited 0 having run nothing. Now a flat `eslint.config.mjs` at the
  root over all four workspaces, recommended rules only (no type-checked rules — `tsc --noEmit`
  already runs per package and type-aware lint would mostly duplicate it). It found 39 problems on
  first run; 35 were config decisions (`no-explicit-any` in tests, the `cond ? pass() : fail()` idiom
  in the e2e scripts, generated `next-env.d.ts`) and **4 were real**: three redundant initialisers
  that `no-useless-assignment` caught in `app.ts`, `admin/page.tsx` and `layout.tsx`, and a stale
  `eslint-disable-next-line` in `escalate.ts` referencing a rule nobody had enabled — written by an
  agent back when no ESLint existed to honour it.
- ~~**Heredoc bodies scanned as commands.**~~ **Closed.** Found by tripping it: appending the journal
  entry for this change was denied because the entry *quotes* a protected path after a `>` as an
  example. `guard-bash.mjs` now strips heredoc bodies before matching. A genuine
  `cat > .claude/hooks/x.mjs <<'EOF'` is still caught — the redirect target sits *before* the marker.
- ~~**Documentation about credentials trips the credential scanner.**~~ **Closed** with two changes,
  because prose describing a credential and prose containing one are identical to a regex: printf
  templates and shell/brace placeholders in the password position now count as placeholders, and an
  explicit `memos-allow-example` marker suppresses one line. A marker beats widening the patterns —
  the scanner stays strict and every suppression is a visible, greppable decision.
- ~~**`claim-without-evidence` recorded intent, not outcome.**~~ **Closed.** A new
  `record-bash.mjs` on `PostToolUse(Bash)` captures the exit code after execution, so the gate now
  blocks two distinct failures: never running the suite, *and* running it, seeing red, and stopping
  anyway. An unrecognised response shape records `null` and degrades to the old behaviour rather than
  guessing "failed".
- ~~**Diff budget measured against `HEAD`.**~~ **Closed.** Found by tripping it three turns running:
  on an uncommitted multi-turn change it re-reported the whole cumulative diff every turn, gating a
  one-file doc edit on ~3,900 lines it didn't write. The `Stop` hook now records the tree size in the
  ledger and gates on the delta since the last turn, quoting the cumulative figure as context only.
  Also fixed an off-by-one there: `split("\n")` counted the empty string after a trailing newline, so
  every untracked file measured one line long.
- ~~**`session-brief.mjs` read only `docs/JOURNAL.md`.**~~ **Closed.** When `MEMOS_API_URL`,
  `MEMOS_AGENT_TOKEN` and `MEMOS_PROJECT_ID` are set it calls `learning.query` — the same intent any
  enrolled agent uses — and injects what the fleet already knows. Strictly best-effort: 1.5s timeout,
  and every failure path (no config, server down, token rejected) falls back to the journal silently,
  because a `SessionStart` hook must never depend on a server being up.
- **The eval worktrees are isolated on disk but share the database.** `git worktree` gives each
  fixture its own checkout, which is enough for the critics — they read code. But an early run of the
  `test-adversary` fixture ran `vitest` from inside the worktree, which connected to the *same*
  Postgres, seeded `project.evalctl`, and died before cleanup. The orphan then broke the real API
  suite's teardown with a foreign-key violation on `teams`, and the suite failed 26 files while
  reporting 147 passing tests — a confusing signature worth recognising. Mitigated by telling the
  fixture not to run the suite (mutation analysis is a reading exercise anyway); the proper fix is a
  throwaway database per eval run. **Isolation is per-resource, not a property you get once.**
- **`process.env` reads as `.env` to the credential-read rule.** `guard-bash.mjs` blocks
  `head … .env`, so any command containing `process.env.SOMETHING` after a `head`/`tail` matches.
  Needs a negative lookbehind for `process`. Found by tripping it while debugging the suite.
- **Diff budget counts lines, not complexity.** A 200-line mechanical rename trips it; a 40-line
  subtle abstraction doesn't. It's a prompt for examination, not a verdict — which is why blocking
  can be satisfied by justifying.
- **CI hook loading is inherited, not asserted.** Hooks load from the checked-out
  `.claude/settings.json`, and `testing/harness_hooks.sh` now asserts that registration and disk
  never drift. But nothing fails if a future `claude-code-action` version stops honouring project
  settings — that would need an end-to-end probe in CI.
- **The unlock is a real hole, deliberately.** `MEMOS_HARNESS_UNLOCK=1` lets an authorised human edit
  the guards without `disableAllHooks` (which would also switch off the credential scanner and the
  end-of-turn gates, precisely while editing guard code). Anyone who can set the environment can
  bypass the write guard. That's the intended trust boundary — the guard exists to stop an *agent*
  quietly disarming itself mid-task, not to defend against the operator.
- **`record-bash.mjs`'s text fallback is heuristic.** With no structured exit code it scans for
  vitest/tsc/eslint failure markers. Absence of a marker records `null`, never `true` — it will never
  claim a run passed on the strength of not having found the word "fail".

## Deliberately not built

- **A large agent/skill library.** Breadth is easy and costs credibility: 200 files nobody can
  defend is worse than 20 that each name the failure mode they exist for.
- **A third-party multi-agent runtime.** Restricted subagents plus one orchestrator skill already
  provide the fan-out; an external runtime would add a dependency to defend and nothing to show.
- **MCP servers.** Nothing here needs one yet. Exposing MemOS itself over MCP is the interesting
  case, and it's on the roadmap above rather than half-built here.

---

## Verify it yourself

```bash
bash testing/harness_hooks.sh            # 60 assertions on the guards themselves
pnpm typecheck                           # 4 workspaces
pnpm lint                                # eslint, flat config at the root — clean
pnpm --filter @memos/api test            # 147 API tests (needs: docker compose up -d db minio)
```

Live proofs, in a session:

| Ask the agent to… | Expected |
|---|---|
| edit `.github/workflows/ci.yml` | `guard-write.mjs` denies, with a reason |
| `echo "x" > .claude/hooks/gate-turn.mjs` | `guard-bash.mjs` denies the shell route too |
| write a `postgres://` URL with a realistic (non-placeholder) password into a `.ts` file | `scan-secrets.mjs` blocks post-write |
| edit `fact.record.ts` and stop without running tests | `gate-turn.mjs` blocks, naming the untested invariant |

## Bootstrap note

`guard-write.mjs` denies writes to `.claude/agents/**` and `.claude/settings.json`. So the harness
has to be built in a specific order — every `.claude/**` file first, hook registration in
`settings.json` **last** — or it locks out its own construction. Changing a hook after that point is
a human edit, by design. That is the constraint working, not a bug.
