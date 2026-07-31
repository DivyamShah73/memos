---
name: gate
description: Run the MemOS machine gates and report a pass/fail table — typecheck, API suite, harness hook tests, diff budget. No model judgment; commands either pass or they don't. Use before proposing any change as done.
---

# /gate — machine gates

The last rung of the enforcement ladder (`docs/HARNESS.md`): checks that are decided by a command's
exit code, not by a model's opinion of the code. Everything above this rung can be reasoned around.
This can't.

Run each gate, capture the real result, and print the table. **Report what happened, including
failures.** A gate table with a fake green in it is worse than no gate table — it converts an
unknown into a false assurance.

## Gates

| # | Gate | Command | Notes |
|---|---|---|---|
| 1 | Typecheck | `pnpm typecheck` | All 4 workspaces (`-r --if-present`) |
| 2 | API suite | `pnpm --filter @memos/api test` | Needs Postgres + MinIO up (`docker compose up -d db minio`) |
| 3 | Harness hooks | `bash testing/harness_hooks.sh` | Proves the guards themselves still work. No DB needed |
| 4 | Diff budget | `git diff --stat HEAD` | Compare against ~150 added lines / 8 files |
| 5 | Lint | `pnpm lint` | `eslint .`, flat config at the root, all 4 workspaces |
| 6 | Dashboard build | `pnpm --filter @memos/web build` | Only when `packages/web` changed |
| 7 | E2E | `pnpm test:e2e` | Only when a user-facing flow changed; slow |

Gates 1-5 always run. 6 and 7 are conditional on what the diff touched — say so when you skip them.

## Gate 5 runs for real now

It used to be a documented no-op: `pnpm lint` was `pnpm -r --if-present run lint`, no package defined
a `lint` script, so it exited 0 having run nothing. It is now `eslint .` against a flat config at the
repo root covering all four workspaces.

Report warnings honestly. **`eslint` exits 0 with warnings, so a green exit is not a clean run** — if
there are warnings, give the count rather than a bare PASS.

## Output

```
## Gates
| Gate | Result | Detail |
|------|--------|--------|
| Typecheck        | PASS | 4 workspaces clean |
| API suite        | PASS | 147 passed |
| Harness hooks    | PASS | 38 passed |
| Diff budget      | PASS | +96 / 5 files (budget 150 / 8) |
| Lint             | PASS | 0 errors, 0 warnings |
| Dashboard build  | SKIP | packages/web untouched |
| E2E              | SKIP | no user-facing flow changed |

## Verdict
READY / NOT READY — <one line>
```

If any gate fails, the verdict is NOT READY. Quote the actual failing output — the assertion, the
type error, the failing test name — not a summary of it. The human needs the error, not your
reading of it.

## If the API suite can't run

Gate 2 needs the compose stack. If Postgres or MinIO isn't up, report
`BLOCKED (infra down)` and say what to start — never `PASS`, and never quietly drop the gate from
the table.
