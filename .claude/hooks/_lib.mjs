/**
 * Shared plumbing for the MemOS agent hooks. NOT a hook itself (underscore prefix, same
 * convention as packages/api/src/intents/_evidence.ts).
 *
 * Why Node and not bash/PowerShell: the same hook files have to run on a Windows dev box and
 * on the ubuntu-latest runner that executes the issue->PR pipeline. One guardrail definition,
 * two execution contexts. The repo is already `"type": "module"` on node >= 20, so this adds
 * zero dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Read the hook's JSON payload from stdin. Never throws: a hook that crashes on malformed
 *  input would fail *open* on every subsequent tool call, which is worse than doing nothing. */
export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Decision envelopes. Exit 0 in every case and let the JSON carry the verdict —
// exit 2 works too but discards stdout, and we want the *reason* to reach the model
// so it can correct itself instead of just seeing an opaque failure.
// ---------------------------------------------------------------------------

export function denyTool(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function blockPostToolUse(reason) {
  emit({ decision: "block", reason });
}

export function blockStop(reason) {
  emit({ decision: "block", reason });
}

export function injectContext(hookEventName, additionalContext) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext } });
}

/** No opinion — fall through to the normal permission flow (settings.json allow/deny lists). */
export function passThrough() {
  process.exit(0);
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

/**
 * Project-relative, forward-slashed path. Both halves matter: hook payloads carry absolute
 * paths, and on Windows they arrive with backslashes — so every pattern below would silently
 * never match if we compared raw. Normalising here is what makes one pattern list work on
 * both platforms.
 */
export function relPath(filePath) {
  if (!filePath) return "";
  return relative(PROJECT_DIR, resolve(PROJECT_DIR, filePath)).split("\\").join("/");
}

/**
 * Files the agent may never edit: the hooks themselves, the settings that register them, and
 * the CI workflows that gate merges. An agent that can rewrite its own constraints has no
 * constraints. This is the whole reason the guard is a hook and not a line in CLAUDE.md.
 */
const SELF_MODIFICATION = [
  /^\.claude\/hooks\//,
  /^\.claude\/settings\.json$/,
  /^\.claude\/agents\//,
  /^\.github\/workflows\//,
];

/**
 * Files carrying a core invariant (CLAUDE.md §"Core invariants"). Touching one without touching
 * a test is how an invariant rots silently: the code still compiles, the suite still passes,
 * and the gate it used to enforce is just gone.
 */
const INVARIANT_FILES = [
  /^packages\/api\/src\/intents\/_evidence\.ts$/,
  /^packages\/api\/src\/intents\/(fact|learning)\.record\.ts$/,
  /^packages\/api\/src\/intents\/artifact\.upload\.ts$/,
  /^packages\/api\/src\/intents\/checkin\.ts$/,
  /^packages\/api\/src\/intents\/workflow\..*\.ts$/,
  /^packages\/api\/src\/core\/scope\.ts$/,
  /^packages\/api\/src\/db\/schema\.ts$/,
  /^infra\/migrations\/.*rls.*\.sql$/i,
];

export const isSelfModification = (rel) => SELF_MODIFICATION.some((re) => re.test(rel));
export const isInvariantFile = (rel) => INVARIANT_FILES.some((re) => re.test(rel));
export const isTestFile = (rel) => /\.(test|spec)\.[cm]?tsx?$/.test(rel);
export const isSourceFile = (rel) =>
  /^packages\/[^/]+\/src\/.*\.[cm]?tsx?$/.test(rel) && !isTestFile(rel);

// ---------------------------------------------------------------------------
// Session ledger
// ---------------------------------------------------------------------------

/**
 * A single PreToolUse hook only ever sees one tool call. The end-of-turn gates need to reason
 * about the turn as a whole ("source changed, but did the suite ever run?"), so each guard
 * appends what it saw to a per-session ledger and gate-turn.mjs reads the accumulated picture.
 */
const STATE_DIR = join(PROJECT_DIR, ".claude", ".state");

const EMPTY = {
  invariantFilesTouched: [],
  testFilesTouched: [],
  sourceFilesTouched: [],
  testRuns: [],
  /** Outcomes recorded post-execution by record-bash.mjs: [{ command, passed: true|false|null }]. */
  testResults: [],
  blocksIssued: [],
  /**
   * Working-tree size as of the last Stop gate: { added, files }. The diff budget gates on the
   * change *since* this point, not on the total against HEAD — otherwise an uncommitted multi-turn
   * change re-reports its whole cumulative size every turn and gates a one-line edit on thousands
   * of lines it didn't write.
   */
  lastSeen: null,
};

function ledgerPath(sessionId) {
  const safe = String(sessionId ?? "no-session").replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(STATE_DIR, `${safe}.json`);
}

export function readLedger(sessionId) {
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(ledgerPath(sessionId), "utf8")) };
  } catch {
    return { ...EMPTY };
  }
}

/** Read-modify-write. Hooks are serialised per tool call, so no locking is needed here. */
export function updateLedger(sessionId, mutate) {
  const next = mutate(readLedger(sessionId)) ?? EMPTY;
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(ledgerPath(sessionId), JSON.stringify(next, null, 2), "utf8");
  } catch {
    // A ledger we can't persist degrades the Stop gates to no-ops. Never fail the tool call
    // over it — the guards above this line are the load-bearing ones.
  }
  return next;
}

export const pushUnique = (arr, value) =>
  value && !arr.includes(value) ? [...arr, value] : arr;
