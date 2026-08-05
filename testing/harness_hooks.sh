#!/usr/bin/env bash
# Asserts every agent-harness hook decision by piping synthetic hook payloads into the scripts.
#
# The repo's own standard is that an enforcement mechanism needs a test proving it holds
# (CLAUDE.md, working agreement). The hooks in .claude/hooks/ ARE enforcement mechanisms, so they
# get the same treatment as the invariants they guard. Without this, a typo in a regex silently
# turns a guard into a no-op and nothing anywhere fails.
#
# Runs in seconds, needs no database, no network, and no API tokens.
#   bash testing/harness_hooks.sh

set -uo pipefail
cd "$(dirname "$0")/.."
export CLAUDE_PROJECT_DIR="$PWD"

HOOKS=".claude/hooks"
PASS=0
FAIL=0
SCRATCH=".claude/.state/scratch"

pass() { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() {
  FAIL=$((FAIL + 1))
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
  printf '       expected: %s\n       got:      %s\n' "$2" "${3:-<empty>}"
}

# assert_has <name> <needle> <actual>
assert_has() {
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1" "output containing '$2'" "$3" ;;
  esac
}

# assert_silent <name> <actual> — a hook with no opinion prints nothing and exits 0,
# falling through to the normal settings.json permission flow.
assert_silent() {
  if [ -z "$2" ]; then pass "$1"; else fail "$1" "no output (pass-through)" "$2"; fi
}

# Cleared for every invocation: MEMOS_HARNESS_UNLOCK in the operator's environment turns four
# denials into pass-throughs, and the suite would report them as failures of the guard rather than
# of the environment. It cost a confusing red run to notice. The unlock gets its own test below.
hook() { env -u MEMOS_HARNESS_UNLOCK node "$HOOKS/$1"; }

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
section "guard-write.mjs — PreToolUse(Edit|Write)"

for target in ".github/workflows/ci.yml" ".claude/hooks/_lib.mjs" ".claude/settings.json" ".claude/agents/refuter.md"; do
  out=$(printf '{"session_id":"t-gw","tool_input":{"file_path":"%s"}}' "$target" | hook guard-write.mjs)
  assert_has "denies self-modification: $target" '"permissionDecision":"deny"' "$out"
done

# The documented escape hatch, tested so it can't become folklore: with the unlock present, the same
# write is allowed. This is the one deliberate hole in the write guard, so it should be visible in the
# suite rather than discovered.
out=$(printf '{"session_id":"t-gw","tool_input":{"file_path":".claude/hooks/_lib.mjs"}}' \
  | MEMOS_HARNESS_UNLOCK=1 node "$HOOKS/guard-write.mjs")
assert_silent "MEMOS_HARNESS_UNLOCK allows an authorised harness edit" "$out"

out=$(printf '{"session_id":"t-gw","tool_input":{"file_path":"packages/api/src/intents/fact.query.ts"}}' | hook guard-write.mjs)
assert_silent "allows ordinary source edit" "$out"

out=$(printf '{"session_id":"t-gw","tool_input":{"file_path":"docs/API.md"}}' | hook guard-write.mjs)
assert_silent "allows docs edit" "$out"

# ---------------------------------------------------------------------------
section "guard-bash.mjs — PreToolUse(Bash)"

deny_bash() {
  out=$(printf '{"session_id":"t-gb","tool_input":{"command":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")" | hook guard-bash.mjs)
  assert_has "denies: $1" '"permissionDecision":"deny"' "$out"
}
allow_bash() {
  out=$(printf '{"session_id":"t-gb","tool_input":{"command":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")" | hook guard-bash.mjs)
  assert_silent "allows: $1" "$out"
}

# Prefix-based deny lists miss all of these; that is why the hook exists alongside them.
deny_bash 'cd /tmp && rm -rf build'
deny_bash 'rm -fr node_modules'
deny_bash 'git push --force origin main'
deny_bash 'docker compose down -v'
deny_bash 'git reset --hard HEAD~3'
deny_bash 'psql $DATABASE_URL -c "DROP TABLE facts"'
deny_bash 'cat .env'

# The corresponding safe forms must NOT be denied — a guard with a bad false-positive rate
# gets switched off, which is worse than not having it.
# Writing to the harness via the shell must be denied too. guard-write.mjs only matches Edit|Write,
# so without this an agent with Bash (the CI triage job, for one) walks straight around it.
deny_bash 'echo "exit 0" > .claude/hooks/gate-turn.mjs'
deny_bash 'cat /tmp/x >> .github/workflows/ci.yml'
deny_bash "sed -i 's/deny/allow/' .claude/settings.json"
deny_bash 'cp /tmp/evil.md .claude/agents/refuter.md'
deny_bash 'echo x | tee .claude/settings.json'

# Heredoc bodies are data, not command. Documentation that quotes a protected path after a redirect
# must pass — this is the false positive that blocked this repo's own journal entry.
allow_bash "$(printf 'cat >> docs/JOURNAL.md <<%sEOF%s\nthe guard denies: echo > .claude/hooks/gate-turn.mjs\nEOF' "'" "'")"
allow_bash "$(printf 'cat >> docs/NOTES.md <<%sEOF%s\nrun: rm -rf build\nand: DROP TABLE facts\nEOF' "'" "'")"
# ...but a real write THROUGH a heredoc is still denied: the target precedes the marker.
deny_bash "$(printf 'cat > .claude/hooks/gate-turn.mjs <<%sEOF%s\nprocess.exit(0)\nEOF' "'" "'")"

# The corresponding safe forms must NOT be denied — a guard with a bad false-positive rate
# gets switched off, which is worse than not having it.
allow_bash 'git push --force-with-lease origin main'
allow_bash 'docker compose down'
allow_bash 'cat .env.example'
allow_bash 'rm dist/stale.js'
allow_bash 'pnpm --filter @memos/api test'
# Reading the harness is legitimate and frequent; only writes to it are blocked.
allow_bash 'cat .claude/settings.json'
allow_bash 'grep -rn permissionDecision .claude/hooks/'
allow_bash 'node .claude/hooks/guard-bash.mjs < /tmp/payload.json'

# ---------------------------------------------------------------------------
section "gate-turn.mjs — Stop"

# gate-turn reasons over BOTH the session ledger and the working-tree diff. Running it against the
# live repo therefore makes every result depend on whatever happens to be uncommitted: this suite
# silently went 46/46 -> 44/46 the moment two unrelated *.test.ts files were edited, because gate 1
# saw changed tests and correctly declined to fire. The hook was right and the test was wrong.
#
# So each case gets a throwaway git repo, with tree state as an explicit input.
TMPREPO=$(mktemp -d)
git -c init.defaultBranch=main init -q "$TMPREPO"
# Mirror the real repo's ignore of the ledger directory. Without it the per-session ledger JSONs
# count as untracked content and inflate the measured diff — which is exactly why `.claude/.state/`
# is in the real .gitignore.
printf '.claude/.state/\n' > "$TMPREPO/.gitignore"
git -C "$TMPREPO" add .gitignore
git -C "$TMPREPO" -c user.email=t@example.com -c user.name=t commit -q -m base

gate() { CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/gate-turn.mjs"; }
seed() { CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/guard-write.mjs" >/dev/null; }

# Seed the ledger the way a real turn would — through the guard, not by hand-writing state.
printf '{"session_id":"g1","tool_input":{"file_path":"packages/api/src/intents/fact.record.ts"}}' | seed

out=$(printf '{"session_id":"g1","prompt_id":"p1"}' | gate)
assert_has "blocks invariant edit with no test" 'invariant-without-test' "$out"
assert_has "  ...and cites the file" 'fact.record.ts' "$out"
assert_has "blocks source edit with no test run" 'claim-without-evidence' "$out"

# Same gate, same turn, second attempt: must not block again or the session deadlocks.
out=$(printf '{"session_id":"g1","prompt_id":"p1"}' | gate)
assert_silent "same gate does not re-block within one turn" "$out"

# stop_hook_active is the second belt against a Stop-hook deadlock.
out=$(printf '{"session_id":"g1","prompt_id":"p2","stop_hook_active":true}' | gate)
assert_silent "honours stop_hook_active" "$out"

# The inverse of gate 1, and the case whose absence let the regression above go unnoticed: an
# invariant edit accompanied by a test edit must NOT block.
printf '{"session_id":"g2","tool_input":{"file_path":"packages/api/src/intents/fact.record.ts"}}' | seed
printf '{"session_id":"g2","tool_input":{"file_path":"packages/api/src/intents/fact.record.test.ts"}}' | seed
printf '{"session_id":"g2","tool_input":{"command":"pnpm --filter @memos/api test"}}' \
  | CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/guard-bash.mjs" >/dev/null
out=$(printf '{"session_id":"g2","prompt_id":"p3"}' | gate)
assert_silent "invariant edit WITH a test and a run passes" "$out"

# A red suite that the agent stops on anyway. Only detectable because record-bash.mjs reads the exit
# code after execution — PreToolUse can only ever see the intent to run.
printf '{"session_id":"g5","tool_input":{"file_path":"packages/api/src/app.ts"}}' | seed
printf '{"session_id":"g5","tool_input":{"command":"pnpm --filter @memos/api test"}}' \
  | CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/guard-bash.mjs" >/dev/null
printf '{"session_id":"g5","tool_input":{"command":"pnpm --filter @memos/api test"},"tool_response":{"exit_code":1}}' \
  | CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/record-bash.mjs" >/dev/null
out=$(printf '{"session_id":"g5","prompt_id":"p6"}' | gate)
assert_has "blocks ending a turn on a red suite" 'last test run this turn FAILED' "$out"

# The same shape with a passing exit code must not block.
printf '{"session_id":"g6","tool_input":{"file_path":"packages/api/src/app.ts"}}' | seed
printf '{"session_id":"g6","tool_input":{"command":"pnpm --filter @memos/api test"}}' \
  | CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/guard-bash.mjs" >/dev/null
printf '{"session_id":"g6","tool_input":{"command":"pnpm --filter @memos/api test"},"tool_response":{"exit_code":0}}' \
  | CLAUDE_PROJECT_DIR="$TMPREPO" node "$HOOKS/record-bash.mjs" >/dev/null
out=$(printf '{"session_id":"g6","prompt_id":"p7"}' | gate)
assert_silent "a green suite ends the turn freely" "$out"

# Diff budget, measured in a tree whose size the test controls.
printf 'line\n%.0s' $(seq 1 200) > "$TMPREPO/big.txt"
out=$(printf '{"session_id":"g3","prompt_id":"p4"}' | MEMOS_DIFF_BUDGET_LINES=50 MEMOS_DIFF_BUDGET_FILES=8 gate)
assert_has "blocks on exceeded diff budget" 'diff-budget' "$out"
# The point of this assertion is that the untracked file is counted at all — `git diff` alone
# reports +0 for it, which is how one enormous new file would sail through the budget.
# NOTE: reports 201 for a 200-line file. `split("\n")` counts the empty string after the trailing
# newline, so every untracked file measures one line long. Tracked in docs/HARNESS.md.
assert_has "  ...counting the untracked file git diff would miss" 'across 1 files' "$out"

# The budget gates on the change SINCE the last Stop, not the cumulative total against HEAD.
# g3 above already ran with big.txt present, so its lastSeen baseline includes those 200 lines —
# a second turn that adds nothing must therefore pass the same budget it just failed.
out=$(printf '{"session_id":"g3","prompt_id":"p8"}' | MEMOS_DIFF_BUDGET_LINES=50 MEMOS_DIFF_BUDGET_FILES=8 gate)
assert_silent "does not re-gate the same lines on the next turn" "$out"

# ...and a genuinely new 200 lines on top of that baseline is still caught.
printf 'more\n%.0s' $(seq 1 200) > "$TMPREPO/big2.txt"
out=$(printf '{"session_id":"g3","prompt_id":"p9"}' | MEMOS_DIFF_BUDGET_LINES=50 MEMOS_DIFF_BUDGET_FILES=8 gate)
assert_has "still catches new work above the baseline" 'diff-budget' "$out"
assert_has "  ...and counts exactly 200, not 201" 'added +200 lines' "$out"

# A turn that touched nothing, in a clean tree, must end freely.
rm -f "$TMPREPO/big.txt" "$TMPREPO/big2.txt"
out=$(printf '{"session_id":"g4","prompt_id":"p5"}' | gate)
assert_silent "clean turn ends freely" "$out"

rm -rf "$TMPREPO"

# ---------------------------------------------------------------------------
section "scan-secrets.mjs — PostToolUse(Edit|Write)"

mkdir -p "$SCRATCH"

# Assembled at runtime — scheme included — so this test file never itself contains a
# credential-shaped literal. Otherwise the scanner would flag the test that tests it, and editing this
# file would become impossible. The scheme has to be interpolated too: leaving it literal and only
# templating the password still matches, because a printf format specifier is not on the placeholder
# allowlist.
SCHEME="postgres"
PW="hunter2ActuallyReal"
printf 'export const db = "%s://memos:%s@db.example.com:5432/memos";\n' "$SCHEME" "$PW" > "$SCRATCH/leak.ts"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/leak.ts"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_has "blocks inline DB password" '"decision":"block"' "$out"
assert_has "  ...and names the file" 'leak.ts' "$out"

KEY_PREFIX="sk-ant-"
printf 'const k = "%sapi03REPLACEDwithLONGlookingKEY123";\n' "$KEY_PREFIX" > "$SCRATCH/key.ts"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/key.ts"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_has "blocks Anthropic key shape" '"decision":"block"' "$out"

# Placeholders must pass, or every doc and .env.example edit trips the guard.
printf 'DATABASE_URL=postgres://user:password@localhost:5432/memos\n' > "$SCRATCH/doc.md"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/doc.md"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_silent "allows obvious placeholder password" "$out"

# A printf template in the password position is a template for a credential, not a credential.
printf 'const url = `%%s://memos:%%s@host/db`;\n' > "$SCRATCH/tpl.ts"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/tpl.ts"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_silent "allows a format-specifier template" "$out"

# The explicit opt-out, for docs that must show a realistic shape to describe what gets blocked.
SCHEME2="postgres"
printf 'See `%s://memos:realLookingPw@host/db` — blocked. memos-allow-example\n' "$SCHEME2" > "$SCRATCH/doc2.md"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/doc2.md"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_silent "honours the memos-allow-example marker" "$out"

# Same line without the marker must still be blocked, or the opt-out is a hole rather than a decision.
printf 'See `%s://memos:realLookingPw@host/db` — blocked.\n' "$SCHEME2" > "$SCRATCH/doc3.md"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/doc3.md"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_has "blocks the same line without the marker" '"decision":"block"' "$out"

printf 'export const greeting = "hello";\n' > "$SCRATCH/clean.ts"
out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/clean.ts"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_silent "allows clean file" "$out"

out=$(printf '{"session_id":"t-ss","tool_input":{"file_path":"%s/does-not-exist.ts"}}' "$SCRATCH" | hook scan-secrets.mjs)
assert_silent "tolerates missing file" "$out"

# ---------------------------------------------------------------------------
section "session-brief.mjs — SessionStart"

out=$(printf '{"session_id":"t-sb","source":"startup"}' | hook session-brief.mjs)
assert_has "injects session context" '"hookEventName":"SessionStart"' "$out"
assert_has "  ...reports the branch" 'Branch:' "$out"
assert_has "  ...states the enforced gates" 'DENIED' "$out"

# ---------------------------------------------------------------------------
section "registration (settings.json <-> .claude/hooks/ must not drift)"

# A hook that exists but isn't registered never runs; a registered path that doesn't exist errors on
# every tool call. Both are silent in normal use — nothing tells you the guard stopped guarding — so
# they get asserted here.
out=$(node -e '
  const fs = require("node:fs");
  const cfg = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
  const registered = new Set();
  for (const entries of Object.values(cfg.hooks ?? {}))
    for (const entry of entries)
      for (const h of entry.hooks ?? [])
        for (const a of h.args ?? [])
          if (a.endsWith(".mjs")) registered.add(a.split("/").pop());

  const problems = [];
  for (const name of registered)
    if (!fs.existsSync(`.claude/hooks/${name}`)) problems.push(`registered but missing: ${name}`);
  for (const name of fs.readdirSync(".claude/hooks"))
    if (name.endsWith(".mjs") && !name.startsWith("_") && !registered.has(name))
      problems.push(`on disk but never registered: ${name}`);

  process.stdout.write(problems.length ? problems.join("; ") : `OK ${registered.size} registered`);
' 2>&1)
case "$out" in
  OK*) pass "every hook registered and present ($out)" ;;
  *) fail "hook registration matches disk" "no drift" "$out" ;;
esac

# ---------------------------------------------------------------------------
section "malformed input (must fail safe, never fail closed)"

# A hook that crashes on junk input would deny every tool call in the session.
for h in guard-write guard-bash scan-secrets gate-turn; do
  out=$(printf 'not json at all' | hook "$h.mjs" 2>&1)
  case "$out" in
    *Error*|*error*|*Cannot*) fail "$h tolerates malformed payload" "no crash" "$out" ;;
    *) pass "$h tolerates malformed payload" ;;
  esac
done

# ---------------------------------------------------------------------------
rm -rf "$SCRATCH"
rm -f .claude/.state/t-*.json

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
