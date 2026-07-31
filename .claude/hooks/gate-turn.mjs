#!/usr/bin/env node
/**
 * Stop hook — the end-of-turn gates. This is the load-bearing hook.
 *
 * A PreToolUse hook sees one call at a time and can only ask "is this call allowed?". The
 * interesting failures are shaped like a *turn*: source was edited but never run, an invariant
 * moved but no test moved with it, a 12-line problem got a 200-line answer. Those are only
 * visible once the agent tries to stop, which is what this hook intercepts.
 *
 * Three gates, each the mechanical form of a rule that CLAUDE.md states but cannot enforce:
 *
 *   1. invariant-without-test  <- "Test the invariants" (CLAUDE.md, working agreement)
 *   2. claim-without-evidence  <- the product's own evidence gate, aimed at the agent:
 *                                 no confident "done" without a run to cite
 *   3. diff-budget             <- the over-generation failure mode: a big block of code where
 *                                 a few lines would do, or a drive-by refactor
 *
 * Loop safety: a Stop hook that blocks unconditionally deadlocks the session. Blocks are keyed
 * by (prompt_id, gate) so each gate fires at most once per turn, and `stop_hook_active` is
 * honoured as a second belt. If a gate can't be satisfied the agent gets one more turn to say
 * so in prose, and then it stops.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  readHookInput,
  blockStop,
  passThrough,
  readLedger,
  updateLedger,
  relPath,
  isTestFile,
  PROJECT_DIR,
} from "./_lib.mjs";

const MAX_ADDED_LINES = Number(process.env.MEMOS_DIFF_BUDGET_LINES ?? 150);
const MAX_FILES = Number(process.env.MEMOS_DIFF_BUDGET_FILES ?? 8);

const input = await readHookInput();

// Already re-entered from a previous block on this turn: let the agent finish.
if (input.stop_hook_active) passThrough();

const ledger = readLedger(input.session_id);
const turnKey = input.prompt_id ?? "no-prompt";
const alreadyBlocked = (gate) => ledger.blocksIssued.includes(`${turnKey}:${gate}`);

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: PROJECT_DIR, encoding: "utf8" });
  } catch {
    return ""; // not a repo, or git unavailable — diff gate degrades to a no-op
  }
};

/**
 * Working-tree size vs HEAD, including files git doesn't know about yet. Untracked files have to
 * be counted separately: `git diff` ignores them entirely, and "the agent added one enormous new
 * file" is precisely the case the budget exists to catch.
 */
function diffStat() {
  let added = 0;
  const files = new Set();

  for (const line of git(["diff", "--numstat", "HEAD"]).split("\n").filter(Boolean)) {
    const [a, , file] = line.split("\t");
    added += Number(a) || 0; // "-" for binary
    if (file) files.add(file);
  }

  for (const file of git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) {
    files.add(file);
    try {
      const abs = join(PROJECT_DIR, file);
      if (statSync(abs).size > 512_000) continue; // don't read blobs to count lines
      // Trim one trailing newline before splitting: a 200-line file ends with "\n", and splitting on
      // it yields a 201st empty element. Left unfixed, every untracked file measured one line long.
      const text = readFileSync(abs, "utf8");
      added += text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
    } catch {
      /* unreadable — don't let it break the gate */
    }
  }

  return { added, files: [...files] };
}

const { added, files } = diffStat();

/**
 * Gate on the change made *since the last time this hook ran*, not on the total against HEAD.
 *
 * Measuring against HEAD looks right and behaves badly: on an uncommitted multi-turn change the gate
 * re-reports the entire cumulative diff every single turn, so a turn that edited one doc gets gated on
 * thousands of lines it didn't write. The question stops being answerable and the gate becomes noise
 * you learn to wave through — which is worse than not having it.
 */
const baseline = ledger.lastSeen ?? { added: 0, files: 0 };
const turnAdded = Math.max(0, added - baseline.added);
const turnFiles = Math.max(0, files.length - baseline.files);

const failures = [];

// Gate 1 — an invariant moved without a test moving with it.
if (ledger.invariantFilesTouched.length > 0 && !alreadyBlocked("invariant-without-test")) {
  const changedTests = files.filter((f) => isTestFile(relPath(f)));
  if (ledger.testFilesTouched.length === 0 && changedTests.length === 0) {
    failures.push({
      gate: "invariant-without-test",
      text:
        `You changed a file that carries a core invariant but no test changed with it:\n` +
        ledger.invariantFilesTouched.map((f) => `  - ${f}`).join("\n") +
        `\n\nCLAUDE.md: "Every change that touches a core invariant needs a test proving it holds."\n` +
        `Add or extend a colocated *.test.ts that would FAIL if this change regressed the gate, ` +
        `then run it. If the change genuinely cannot affect an invariant, say which one and why.`,
    });
  }
}

// Gate 2 — the evidence gate, pointed at the agent instead of at a fact. Two distinct failures:
// never running the suite, and running it, seeing red, and stopping anyway. The second is only
// detectable because record-bash.mjs captures the exit code post-execution — PreToolUse fires before
// the command runs, so intent is all it can see.
if (ledger.sourceFilesTouched.length > 0 && !alreadyBlocked("claim-without-evidence")) {
  const lastResult = ledger.testResults.at(-1) ?? null;

  if (ledger.testRuns.length === 0) {
    failures.push({
      gate: "claim-without-evidence",
      text:
        `You edited ${ledger.sourceFilesTouched.length} source file(s) this turn and never ran the suite.\n` +
        `Run \`pnpm --filter @memos/api test\` (or the relevant workspace) before ending the turn.\n\n` +
        `This is the same rule the product enforces on its own writes: a claim at confidence ` +
        `>= medium must cite evidence. "I implemented it" is such a claim; the test run is the evidence.`,
    });
  } else if (lastResult?.passed === false) {
    failures.push({
      gate: "claim-without-evidence",
      text:
        `The last test run this turn FAILED and you are ending the turn anyway.\n` +
        `  ${lastResult.command}\n\n` +
        `Either fix it, or state plainly in your response that the suite is red and why — do not ` +
        `end on an implied green. An inaccurate status costs more than a failing test.`,
    });
  }
}

// Gate 3 — over-generation and scope creep.
if ((turnAdded > MAX_ADDED_LINES || turnFiles > MAX_FILES) && !alreadyBlocked("diff-budget")) {
  failures.push({
    gate: "diff-budget",
    text:
      `Diff budget exceeded: this turn added +${turnAdded} lines across ${turnFiles} file(s) ` +
      `(budget: ${MAX_ADDED_LINES} lines / ${MAX_FILES} files). ` +
      `Working tree total vs HEAD: +${added} across ${files.length} files.\n\n` +
      `Before ending the turn, do one of these:\n` +
      `  a) Cut it down — run the altitude-critic subagent, or /simplify, and remove what the task ` +
      `didn't ask for (speculative abstraction, defensive try/catch, config nobody requested, ` +
      `comments restating the code).\n` +
      `  b) Justify it — state explicitly why this task genuinely needs this much code, and confirm ` +
      `nothing here duplicates something that already exists in the repo.\n\n` +
      `Large diffs are not forbidden. Unexamined ones are.`,
  });
}

// Record the tree size for the next turn's baseline, on BOTH paths — a passing turn still moves the
// mark, otherwise the next turn inherits this turn's work as its own delta.
updateLedger(input.session_id, (led) => ({
  ...led,
  lastSeen: { added, files: files.length },
  blocksIssued: [...led.blocksIssued, ...failures.map((f) => `${turnKey}:${f.gate}`)],
}));

if (failures.length === 0) passThrough();

blockStop(
  failures
    .map((f, i) => `[gate ${i + 1}/${failures.length}: ${f.gate}]\n${f.text}`)
    .join("\n\n---\n\n"),
);
