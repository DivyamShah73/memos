#!/usr/bin/env -S npx tsx
/**
 * MemOS as an MCP server — the loop closing.
 *
 * The harness in `.claude/` governs *how* an agent works: what it may touch, what it must test, when
 * it may stop. This exposes the other half — the org's accumulated knowledge — to any MCP-capable
 * coding agent, over the same intent-RPC gateway every enrolled agent already uses.
 *
 * Two consequences worth understanding, because they're the point rather than a side effect:
 *
 *  1. **The agent can ask what the fleet already learned** before re-deriving it. That's the product's
 *     entire thesis, applied to the agent building the product.
 *
 *  2. **The agent is subject to the product's write gates.** `memos_learning_record` posts through
 *     `learning.record`, so a claim at confidence >= medium without an `evidence_artifact_id` is
 *     rejected by Postgres-side rules the agent cannot see or argue with. The MCP tool does not
 *     re-implement that check — deliberately. Re-implementing it here would create a second copy to
 *     drift, and would let a caller who skips this server bypass it. The gate lives at the boundary
 *     that every writer crosses.
 *
 * Deliberately thin: ~150 lines, because `@memos/agent` already exists and is typed. An MCP server
 * that reimplemented the client would be the exact reinvention `reuse-scout` exists to prevent.
 *
 * Transport is stdio — Claude Code spawns this as a subprocess, so there's no port, no auth surface
 * of its own, and it inherits the operator's credentials from the environment.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemosClient, MemosError } from "@memos/agent";
import { z } from "zod";

const API_URL = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MEMOS_AGENT_TOKEN;
const DEFAULT_PROJECT = process.env.MEMOS_PROJECT_ID;

if (!TOKEN) {
  // stderr, not stdout: stdout is the JSON-RPC channel and any stray byte corrupts the protocol.
  process.stderr.write(
    "memos-mcp: MEMOS_AGENT_TOKEN is not set. Enroll an agent and export it before starting.\n",
  );
  process.exit(1);
}

const client = new MemosClient(API_URL, TOKEN);

/**
 * Every tool returns text content. Errors are returned as `isError` results rather than thrown, so
 * the model sees *why* a call failed and can correct itself — a rejected write with the reason
 * "evidence_artifact_id is required when confidence >= medium" is far more useful than a stack trace,
 * and it is the same reasoning as the hooks returning a reason instead of a bare denial.
 */
async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    const detail =
      err instanceof MemosError
        ? `${err.message} (error_type: ${err.errorType})`
        : err instanceof Error
          ? err.message
          : String(err);
    return { content: [{ type: "text" as const, text: `MemOS rejected the call: ${detail}` }], isError: true };
  }
}

/** `project_id` is required by every intent; default it so the common case is a one-argument call. */
const projectId = z
  .string()
  .default(() => DEFAULT_PROJECT ?? "")
  .describe("Project scope, e.g. project.acme. Defaults to MEMOS_PROJECT_ID.");

const server = new McpServer({ name: "memos", version: "0.0.0" });

server.tool(
  "memos_learning_query",
  "Search the organisation's accumulated LEARNINGS by problem domain before solving something " +
    "yourself. Learnings are deliberately tagged by problem domain (fine-tuning, vllm-deployment), " +
    "never by project, so a learning from another team surfaces here. Call this FIRST on any " +
    "non-trivial task — it is the cheapest way to avoid re-deriving something the fleet already paid " +
    "for.",
  {
    query: z.string().min(1).describe("Keywords, e.g. 'cold start latency' or 'rls policy'"),
    applies_to: z
      .array(z.string())
      .optional()
      .describe("Optional problem-domain tag filter, e.g. ['vllm-deployment']"),
    project_id: projectId,
    limit: z.number().int().positive().max(50).optional(),
  },
  (args) => run(() => client.learningQuery(args)),
);

server.tool(
  "memos_fact_query",
  "Search verified FACTS recorded in a project — measurements, benchmarks, observed behaviour. " +
    "Unlike learnings, facts are project-scoped. Use when you need a number someone already measured " +
    "rather than a transferable lesson.",
  {
    query: z.string().min(1),
    project_id: projectId,
    limit: z.number().int().positive().max(50).optional(),
  },
  (args) => run(() => client.factQuery(args)),
);

server.tool(
  "memos_learning_record",
  "Record a reusable, non-obvious LEARNING so the rest of the org gets it. " +
    "Gated on purpose: at confidence 'medium' or 'high' this REQUIRES an evidence_artifact_id " +
    "pointing at a real artifact in the same run, and a non_obvious_marker of at least 15 characters. " +
    "Those gates are enforced by the server and the database, not here — if you have not produced " +
    "evidence, record it at 'low' confidence or do not record it at all. Tag applies_to with problem " +
    "domains, never with project or product names.",
  {
    bd_id: z.string().describe("The workflow run this learning came out of (the provenance thread)"),
    claim: z.string().min(1).describe("The transferable lesson, stated so another team could act on it"),
    applies_to: z
      .array(z.string().min(1))
      .min(1)
      .describe("Problem-domain tags, e.g. ['vllm-deployment']. NOT project or product names."),
    confidence: z.enum(["low", "medium", "high"]),
    non_obvious_marker: z
      .string()
      .optional()
      .describe("Why this is not obvious. Required (>=15 chars) at medium/high confidence."),
    evidence_artifact_id: z
      .string()
      .optional()
      .describe("Artifact backing the claim. Required at medium/high confidence."),
    project_id: projectId,
  },
  // bd_id and project_id are envelope-level; the rest is the learning item. The batched shape is
  // flattened here so the model calls this with one flat object instead of nesting an array by hand.
  ({ project_id, bd_id, ...learning }) =>
    run(() => client.learningRecord({ project_id, bd_id, learnings: [learning] } as never)),
);

server.tool(
  "memos_whoami",
  "Show which agent identity, org and project scopes this MCP connection is authenticated as. " +
    "Use to confirm what you are allowed to read before assuming an empty result means 'nothing exists'.",
  {},
  () => run(() => client.agentMe()),
);

await server.connect(new StdioServerTransport());
