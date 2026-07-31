#!/usr/bin/env node
/**
 * PostToolUse hook on Edit|Write — blocks a write that put a credential into a tracked file.
 *
 * The failure mode is specific and common: the agent reads .env to understand the config (or
 * sees a connection string in a log), then writes that literal value into source, a test
 * fixture, or a doc. It isn't malice, and CLAUDE.md wouldn't stop it — the agent is being
 * helpful with a value it already has in context.
 *
 * Runs post-write and reads the file from disk rather than parsing tool_input, so Edit and Write
 * are handled identically without depending on which field carried the content.
 *
 * False positives are the reason a hook like this gets disabled, so placeholders are allowed
 * explicitly: this repo's .env.example genuinely ships `postgres://postgres:postgres@localhost`,
 * and the docs quote token shapes.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readHookInput, blockPostToolUse, passThrough, relPath, PROJECT_DIR } from "./_lib.mjs";

/**
 * Values that are obviously illustrative rather than real. The last three entries matter more than
 * they look: a printf template (`%s`), a shell variable, or a brace placeholder in the password
 * position means the line is a *template* for a credential, not a credential — which is what test
 * fixtures and generated-config code legitimately contain.
 */
const PLACEHOLDER =
  /^(postgres|password|passwd|secret|changeme|example|test|user|admin|xxx+|\.\.\.|<[^>]+>|your[-_].*|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[a-zA-Z]|\{\{?[^}]*\}?\})$/i;

/**
 * Explicit, greppable opt-out for the one genuinely legitimate case: documentation that has to show a
 * realistic credential shape in order to describe what gets blocked. Found the hard way — a line in
 * docs/HARNESS.md, and then the comment written to explain that line.
 *
 * A marker is much better than widening the patterns: it keeps the scanner strict, and every
 * suppression is a visible, reviewable decision rather than a silent hole.
 */
const SUPPRESS = "memos-allow-example";

const PATTERNS = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // The product's own token prefix (CLAUDE.md: "show the raw syn_... exactly once on enroll").
  { name: "MemOS agent token", re: /\bsyn_[A-Za-z0-9_-]{20,}/ },
  { name: "AWS access key id", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "private key block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    name: "database URL with inline password",
    re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:([^\s@/]+)@/,
    // Group 2 is the password; a placeholder there means this is documentation, not a leak.
    placeholderGroup: 2,
  },
];

const SKIP_FILES = [/^\.env\.(example|sample|template)$/, /^\.gitattributes$/];

const input = await readHookInput();
const rel = relPath(input.tool_input?.file_path);

if (!rel || SKIP_FILES.some((re) => re.test(rel))) passThrough();

let content = "";
try {
  const abs = join(PROJECT_DIR, rel);
  if (statSync(abs).size > 1_000_000) passThrough(); // not a hand-authored file
  content = readFileSync(abs, "utf8");
} catch {
  passThrough(); // deleted, renamed, or binary — nothing to scan
}

for (const { name, re, placeholderGroup } of PATTERNS) {
  const match = content.match(re);
  if (!match) continue;
  if (placeholderGroup && PLACEHOLDER.test(match[placeholderGroup] ?? "")) continue;

  const line = content.slice(0, match.index).split("\n").length;
  if ((content.split("\n")[line - 1] ?? "").includes(SUPPRESS)) continue;

  blockPostToolUse(
    `Blocked: \`${rel}\` line ${line} appears to contain a real credential (${name}).\n\n` +
      `Remove the literal value and read it from the environment instead — the API's config ` +
      `loader already reads the repo-root .env, and .env.example documents the shape.\n\n` +
      `If this is a deliberate placeholder, make it obviously fake (e.g. \`sk-ant-EXAMPLE\`, ` +
      `\`postgres://user:password@host\`) so it reads as documentation to the next person too.`,
  );
}

passThrough();
