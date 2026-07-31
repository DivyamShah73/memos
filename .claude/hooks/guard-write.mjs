#!/usr/bin/env node
/**
 * PreToolUse hook on Edit|Write.
 *
 * Two jobs:
 *   1. Deny any write that would modify the harness itself (hooks, the settings that register
 *      them, subagent definitions, CI workflows). An agent able to edit its own guardrails is
 *      unguarded — and this is exactly the write an agent reaches for when a gate is
 *      inconvenient. CLAUDE.md cannot enforce this; a hook can.
 *   2. Record invariant/source/test file touches in the session ledger so the end-of-turn
 *      gates in gate-turn.mjs can see the shape of the whole turn.
 *
 * The deny is deliberately *not* absolute policy: a human edits these files directly, and the
 * settings.json `deny` list stays in place underneath as a coarser second layer. Same
 * defense-in-depth pattern as _evidence.ts re-asserting a gate the Zod schema already checked.
 */
import {
  readHookInput,
  denyTool,
  passThrough,
  relPath,
  isSelfModification,
  isInvariantFile,
  isTestFile,
  isSourceFile,
  updateLedger,
  pushUnique,
} from "./_lib.mjs";

/**
 * Documented escape hatch for an authorised harness change.
 *
 * The alternative is `disableAllHooks` in settings.local.json, which is far too blunt: it also switches
 * off the credential scanner and the end-of-turn gates, precisely while you're editing guard code and
 * most want them. This narrows the unlock to the one guard that's in the way.
 *
 * It is not something the agent can grant itself. Hooks inherit the environment Claude Code was
 * started with; a Bash tool call gets its own shell, and shell state does not persist between calls.
 * The other route in — `env` in `.claude/settings.json` — is itself a protected path.
 */
const UNLOCKED = process.env.MEMOS_HARNESS_UNLOCK === "1";

const input = await readHookInput();
const rel = relPath(input.tool_input?.file_path);

if (!rel) passThrough();

if (isSelfModification(rel) && !UNLOCKED) {
  denyTool(
    `Blocked: \`${rel}\` is part of the agent harness (hooks, subagent definitions, settings, ` +
      `or CI workflows). An agent may not modify the mechanism that constrains it.\n\n` +
      `If this change is genuinely needed, say so in your response and let the human make it — ` +
      `do not route around the guard.`,
  );
}

updateLedger(input.session_id, (led) => ({
  ...led,
  invariantFilesTouched: isInvariantFile(rel)
    ? pushUnique(led.invariantFilesTouched, rel)
    : led.invariantFilesTouched,
  testFilesTouched: isTestFile(rel) ? pushUnique(led.testFilesTouched, rel) : led.testFilesTouched,
  sourceFilesTouched: isSourceFile(rel)
    ? pushUnique(led.sourceFilesTouched, rel)
    : led.sourceFilesTouched,
}));

passThrough();
