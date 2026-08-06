#!/usr/bin/env node
/**
 * PostToolUse hook on Bash — records the OUTCOME of a test run, not just the intent to run one.
 *
 * Why this exists as a separate hook from guard-bash.mjs: `PreToolUse` fires *before* the command
 * executes, so the exit code isn't knowable there. That left the `claim-without-evidence` gate able to
 * catch only "never ran the suite" — the failure we actually see — while "ran it, saw red, reported
 * green" slipped through. This closes that.
 *
 * The tool_response shape isn't something to rely on blindly, so this reads several plausible shapes
 * and falls back to scanning the output text. An unrecognised shape records `passed: null`, which the
 * Stop gate treats as "ran, outcome unknown" — the previous behaviour. Degrading to the old behaviour
 * is the right failure mode; guessing "failed" would block turns for no reason.
 */
import { readHookInput, passThrough, updateLedger } from "./_lib.mjs";

const TEST_RUN =
  /\b(vitest|pnpm\s+(-r\s+)?(--filter\s+\S+\s+)?(run\s+)?test|pnpm\s+test|npm\s+test|pnpm\s+typecheck|pnpm\s+lint)\b/;

/** Vitest/tsc/eslint failure signatures, for when no structured status is available. */
const FAILURE_TEXT =
  /\b([1-9]\d*\s+failed|test(s)?\s+failed|FAIL\b|✗|error TS\d+|✖\s+\d+\s+problems?\s+\(\s*[1-9])/;
/**
 * Returns true (passed), false (failed), or null (ran, can't tell). Checks structured fields first —
 * an exit code is authoritative — and only falls back to text when there is none.
 */
function outcomeOf(response) {
  if (response == null) return null;

  if (typeof response === "object") {
    for (const key of ["exit_code", "exitCode", "code", "status", "returnCode"]) {
      const value = response[key];
      if (typeof value === "number") return value === 0;
    }
    if (typeof response.is_error === "boolean") return !response.is_error;
    if (typeof response.success === "boolean") return response.success;
    if (response.interrupted === true) return null;
  }

  const text = typeof response === "string" ? response : JSON.stringify(response);
  if (!text) return null;
  return FAILURE_TEXT.test(text) ? false : null; // absence of failure markers is not proof of success
}

const input = await readHookInput();
const command = input.tool_input?.command ?? "";

if (!command || !TEST_RUN.test(command)) passThrough();

const passed = outcomeOf(input.tool_response);

updateLedger(input.session_id, (led) => ({
  ...led,
  testResults: [...led.testResults, { command: command.slice(0, 200), passed }],
}));

passThrough();
