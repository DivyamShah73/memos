#!/usr/bin/env node
/**
 * SessionStart hook — pulls the org's learnings into the session before the agent does anything.
 *
 * Installed by `npx memos-os-mcp init`.
 *
 * Why this exists, and why the MCP tools alone are not enough:
 *
 *   Registering the MCP server makes MemOS *available*. It does not make an agent *use* it. The only
 *   nudge is the tool description saying "call this FIRST", and a tool description is a suggestion —
 *   the same class of thing as a line in CLAUDE.md. It works often. Often is not a guarantee.
 *
 *   A hook is not a suggestion. It runs before the agent's first token, whether or not the agent
 *   would have thought to ask. So the fleet's knowledge arrives as context rather than as an
 *   opportunity the agent may or may not take.
 *
 * Fails open, always. A memory layer that can break your coding session when it is down is worse
 * than no memory layer, so every failure path — no config, server unreachable, bad token, slow
 * response — exits silently and leaves the session exactly as it would have been.
 */
const API = process.env.MEMOS_API_URL;
const TOKEN = process.env.MEMOS_AGENT_TOKEN;
const PROJECT = process.env.MEMOS_PROJECT_ID;
const LIMIT = Number(process.env.MEMOS_PRELOAD_LIMIT ?? 8);

const quit = () => process.exit(0);

// Drain stdin so the caller never blocks on a full pipe, then ignore it — SessionStart carries no
// input this hook needs.
for await (const _ of process.stdin) void _;

if (!API || !TOKEN || !PROJECT) quit();

try {
  const res = await fetch(`${API}/v1/intent/learning.list`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ project_id: PROJECT, limit: LIMIT }),
    // Short: a session must not wait on a network call. Better to start cold than start late.
    signal: AbortSignal.timeout(2500),
  });

  const json = await res.json();
  const learnings = json?.data?.learnings ?? [];
  if (!json?.ok || learnings.length === 0) quit();

  const lines = learnings.map((l) => {
    const tags = Array.isArray(l.appliesTo ?? l.applies_to) ? (l.appliesTo ?? l.applies_to).join(", ") : "";
    const marker = l.nonObviousMarker ?? l.non_obvious_marker;
    return `- **${l.claim}**${tags ? `  _(${tags})_` : ""}${marker ? `\n  why it's non-obvious: ${marker}` : ""}`;
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: [
          `## What this organisation already learned (MemOS, project \`${PROJECT}\`)`,
          "",
          "These are verified, evidence-backed learnings from other agents and teams. Treat them as",
          "prior art: check them before re-deriving something, and prefer them over your own guess",
          "when they conflict.",
          "",
          ...lines,
          "",
          `_Search more with the \`memos_learning_query\` tool. Record what you learn with_`,
          `_\`memos_learning_record\` — medium/high confidence requires an evidence artifact._`,
        ].join("\n"),
      },
    }),
  );
} catch {
  // Unreachable, unauthorised, timed out, malformed — all the same answer: say nothing.
}
quit();
