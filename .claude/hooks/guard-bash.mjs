#!/usr/bin/env node
/**
 * PreToolUse hook on Bash.
 *
 * The settings.json `deny` list already blocks a handful of literal command prefixes. This hook
 * exists for the two things a static allow/deny list structurally cannot do:
 *
 *   1. Match semantically rather than by prefix — `deny: Bash(rm -rf:*)` is defeated by
 *      `cd /tmp && rm -rf x`, by `rm -fr`, or by any leading pipeline stage.
 *   2. Return a *reason* to the model. A denied permission is opaque; a reason lets the agent
 *      correct course instead of retrying variations of the same blocked command.
 *
 * It also records test-suite invocations in the ledger, which is what lets the Stop gate ask
 * "source changed this turn — was it ever actually run?"
 */
import {
  readHookInput,
  denyTool,
  passThrough,
  updateLedger,
  pushUnique,
} from "./_lib.mjs";

/**
 * Each entry names the irreversible or exfiltrating outcome, not the syntax. Ordered most to
 * least likely to be reached for by an agent that is stuck.
 */
const DENIED = [
  {
    re: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf]{2}[a-zA-Z]*\b|\brm\s+-[rf]\s+-[rf]\b/,
    why: "recursive delete — irreversible. Delete specific paths, or ask the human.",
  },
  {
    re: /\bgit\s+push\b[^\n]*(--force(?!-with-lease)|\s-f\b)/,
    why: "force-push discards remote history. Use --force-with-lease, or ask the human.",
  },
  {
    re: /\bdocker[\s-]compose\s+down\b[^\n]*(-v|--volumes)/,
    why: "drops the Postgres + MinIO volumes, destroying local data. `docker compose down` alone is safe.",
  },
  {
    re: /\bgit\s+reset\s+--hard\b/,
    why: "discards uncommitted work with no recovery path. Stash instead.",
  },
  {
    re: /\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s+TABLE)\b/i,
    why: "destructive DDL. Schema changes go through a Drizzle migration in infra/migrations/ (CLAUDE.md: schema-as-code).",
  },
  {
    re: /\b(cat|type|less|more|head|tail|Get-Content)\b[^\n|]*\.env\b(?!\.example|\.sample)/,
    why: "prints real secrets into the transcript. Read .env.example for the shape of the config instead.",
  },
  {
    re: /(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*(\.env\b(?!\.example)|\$ANTHROPIC|\$DATABASE_URL|\$AWS_)/,
    why: "sends credentials to a network endpoint. If a request needs auth, reference the env var inside the process, never in an outbound command line.",
  },
];

/**
 * guard-write.mjs only matches the Edit|Write tools. An agent that has been denied those — or that
 * simply finds the shell more convenient — writes files with `echo >`, `tee`, `sed -i`, or `cp`,
 * and sails straight past it. The CI triage job is exactly this shape: Bash allowed, Edit/Write
 * denied.
 *
 * So the same protected paths are enforced on this side too. Matching is deliberately narrow —
 * the protected path must be the *target* of a write, not merely mentioned — because reading these
 * files is legitimate and constantly useful (`cat .claude/settings.json`, `grep -r .claude/hooks`).
 */
const PROTECTED = String.raw`(?:\.claude/(?:hooks|agents)/|\.claude/settings\.json|\.github/workflows/)`;
const SHELL_WRITES_PROTECTED = new RegExp(
  [
    String.raw`>>?\s*["']?[^\s"'|;&]*${PROTECTED}`, // echo ... > .claude/hooks/x.mjs
    String.raw`\btee\b\s+(?:-a\s+)?["']?[^\s"'|;&]*${PROTECTED}`, // ... | tee .claude/settings.json
    String.raw`\bsed\b[^|;&]*-i[^|;&]*${PROTECTED}`, // sed -i 's/deny/allow/' .claude/settings.json
    String.raw`\b(?:cp|mv|install|dd\s+of=)\b[^|;&]*${PROTECTED}`, // cp /tmp/x .claude/hooks/
  ].join("|"),
);

/**
 * A heredoc body is DATA the command writes, not command text — and scanning it as though it were the
 * command produces false positives on exactly the wrong thing: documentation *about* the guards.
 * Appending this repo's own journal entry was denied because the entry quotes a protected path after a
 * redirect as an example.
 *
 * A genuine `cat > .claude/hooks/x.mjs <<'EOF'` is still caught, because the redirect target sits
 * before the `<<` marker and survives the strip.
 */
const stripHeredocs = (cmd) =>
  cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, "<<HEREDOC");

const TEST_RUN =
  /\b(vitest|pnpm\s+(-r\s+)?(--filter\s+\S+\s+)?(run\s+)?test|pnpm\s+test|npm\s+test)\b/;

const input = await readHookInput();
const command = input.tool_input?.command ?? "";

if (!command) passThrough();

// Match against the command with heredoc payloads removed; report the original in the message.
const scanned = stripHeredocs(command);

const hit = DENIED.find(({ re }) => re.test(scanned));
if (hit) {
  denyTool(`Blocked: ${hit.why}\n\nCommand: \`${command}\``);
}

if (SHELL_WRITES_PROTECTED.test(scanned)) {
  denyTool(
    `Blocked: this command writes to the agent harness (hooks, subagent definitions, settings, or ` +
      `CI workflows) via the shell. An agent may not modify the mechanism that constrains it — ` +
      `and routing around the Edit/Write guard with a redirect counts.\n\n` +
      `Reading these files is fine. If a change to one is genuinely needed, say so and let the ` +
      `human make it.\n\nCommand: \`${command}\``,
  );
}

// Note this is *intent* to run the suite, not a pass. PreToolUse fires before execution, so the
// exit code isn't knowable here — PostToolUse would be needed for that. The Stop gate therefore
// treats this as "the agent ran the tests and saw the result", and relies on the model not
// claiming green on a red run. Recording intent catches the failure mode we actually see, which
// is not running the suite at all.
if (TEST_RUN.test(command)) {
  updateLedger(input.session_id, (led) => ({
    ...led,
    testRuns: pushUnique(led.testRuns, command.slice(0, 200)),
  }));
}

passThrough();
