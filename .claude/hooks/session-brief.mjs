#!/usr/bin/env node
/**
 * SessionStart hook — injects the state a cold agent would otherwise have to rediscover, or
 * worse, guess at: which branch it's on, what's already dirty, and what the last session did.
 *
 * This is the one hook that adds context rather than removing capability. It's also the cheapest
 * defence against the most common real-world failure: an agent starting work on top of someone
 * else's half-finished change because it never looked.
 *
 * It also dogfoods the product: if MEMOS_API_URL and MEMOS_AGENT_TOKEN are set, it opens the session
 * by asking MemOS what the fleet already learned about this problem domain, via the same
 * `learning.query` intent any other agent would use. The harness reading from the product it builds.
 *
 * That call is strictly best-effort. A SessionStart hook must never depend on a server being up, so it
 * has a short timeout and any failure falls back silently to the journal.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readHookInput, injectContext, passThrough, PROJECT_DIR } from "./_lib.mjs";

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: PROJECT_DIR, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

await readHookInput();

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "(unknown)";
const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);

/** Last complete paragraph of the journal — what the previous session actually did and gated on. */
function lastJournalEntry() {
  try {
    const text = readFileSync(join(PROJECT_DIR, "docs", "JOURNAL.md"), "utf8");
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 80);
    const last = paragraphs.at(-1)?.trim() ?? "";
    return last.length > 1200 ? `${last.slice(0, 1200)}…` : last;
  } catch {
    return "";
  }
}

const dirtyList =
  dirty.length === 0
    ? "clean"
    : `${dirty.length} file(s):\n${dirty.slice(0, 12).map((l) => `    ${l}`).join("\n")}` +
      (dirty.length > 12 ? `\n    …and ${dirty.length - 12} more` : "");

/**
 * Ask MemOS what the fleet already knows. Uses the product's own intent-RPC endpoint and agent token,
 * exactly as any enrolled agent would — no special path for the harness.
 *
 * Every failure mode here returns "" and the session continues on the journal alone: no env configured,
 * server down, token rejected, slow response. A guard on the way in must not be able to stop you
 * working.
 */
async function fleetLearnings() {
  const base = process.env.MEMOS_API_URL;
  const token = process.env.MEMOS_AGENT_TOKEN;
  const project = process.env.MEMOS_PROJECT_ID;
  if (!base || !token || !project) return "";

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/intent/learning.query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: project, query: "agent harness hooks guardrails", limit: 5 }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return "";

    const body = await res.json();
    const learnings = body?.ok ? (body.data?.learnings ?? []) : [];
    if (learnings.length === 0) return "";

    return learnings
      .map((l) => `- ${l.claim}${l.non_obvious_marker ? ` _(${l.non_obvious_marker})_` : ""}`)
      .join("\n");
  } catch {
    return ""; // unreachable, unauthorised, or too slow — the journal is enough
  }
}

const fleet = await fleetLearnings();

injectContext(
  "SessionStart",
  [
    `## Session brief (injected by .claude/hooks/session-brief.mjs)`,
    ``,
    `**Branch:** ${branch}`,
    `**Working tree:** ${dirtyList}`,
    ``,
    `**Enforced gates in this repo** — these are hooks, not suggestions, so plan around them:`,
    `- Writes to \`.claude/hooks/**\`, \`.claude/agents/**\`, \`.claude/settings.json\`, \`.github/workflows/**\` are DENIED.`,
    `- Editing a core-invariant file without changing a test BLOCKS the end of the turn.`,
    `- Editing \`packages/*/src\` without running the suite BLOCKS the end of the turn.`,
    `- A diff over ~150 added lines or 8 files BLOCKS until cut down or justified.`,
    `- A write containing a real credential is BLOCKED post-write.`,
    `See \`docs/HARNESS.md\` for why each exists.`,
    ``,
    ...(fleet
      ? [`**What the fleet already learned** (MemOS \`learning.query\`):`, fleet, ``]
      : []),
    `**Last journal entry:**`,
    lastJournalEntry() || "_(none)_",
  ].join("\n"),
);

passThrough();
