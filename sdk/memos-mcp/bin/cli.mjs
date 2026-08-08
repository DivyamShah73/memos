#!/usr/bin/env node
/**
 * memos-os-mcp — MemOS for any MCP-capable coding agent.
 *
 *   npx memos-os-mcp init     wire it into this repo (MCP server + session preload)
 *   npx memos-os-mcp          run the server (what the agent invokes; stdio)
 *
 * Self-contained on purpose. The repo's server.ts imports @memos/agent, which is a workspace package
 * whose `main` points at TypeScript source — fine inside the monorepo, unpublishable outside it,
 * because a consumer's Node cannot run .ts. Rather than add a build chain for two dozen lines of
 * HTTP, the wire call is inlined below. That duplication is deliberate and it is the entire cost of
 * being installable.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Wire call — the whole MemOS client, inlined.
// ---------------------------------------------------------------------------

const API = process.env.MEMOS_API_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MEMOS_AGENT_TOKEN;
const PROJECT = process.env.MEMOS_PROJECT_ID;

/** POST an intent. MemOS returns a uniform envelope, so ok:false is a business rule, not a crash. */
async function intent(name, body) {
  const res = await fetch(`${API}/v1/intent/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `non-JSON response (${res.status})` }));
  if (!json.ok) throw new Error(`${json.error ?? "request failed"} (${json.error_type ?? res.status})`);
  return json.data;
}

// ---------------------------------------------------------------------------
// init — the answer to "a token doesn't make my agent use it"
// ---------------------------------------------------------------------------

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function init() {
  const cwd = process.cwd();
  const mcpPath = join(cwd, ".mcp.json");
  const settingsPath = join(cwd, ".claude", "settings.json");
  const hookDir = join(cwd, ".claude", "hooks");

  // 1. Register the MCP server so the tools exist.
  const mcp = readJson(mcpPath, {});
  mcp.mcpServers ??= {};
  mcp.mcpServers.memos = {
    command: "npx",
    args: ["-y", "memos-os-mcp"],
    env: {
      MEMOS_API_URL: "${MEMOS_API_URL}",
      MEMOS_AGENT_TOKEN: "${MEMOS_AGENT_TOKEN}",
      MEMOS_PROJECT_ID: "${MEMOS_PROJECT_ID}",
    },
  };
  writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

  // 2. Install the SessionStart hook. This is the part that matters: exposing tools makes MemOS
  //    *available*, it does not make an agent *use* it. Tool descriptions are a suggestion — same
  //    class of thing as a line in CLAUDE.md. A hook runs whether or not the agent thought to ask.
  mkdirSync(hookDir, { recursive: true });
  const hookSrc = readFileSync(join(HERE, "..", "hooks", "memos-preload.mjs"), "utf8");
  writeFileSync(join(hookDir, "memos-preload.mjs"), hookSrc);

  const settings = readJson(settingsPath, {});
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const already = JSON.stringify(settings.hooks.SessionStart).includes("memos-preload.mjs");
  if (!already) {
    settings.hooks.SessionStart.push({
      hooks: [
        {
          type: "command",
          command: "node",
          args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/memos-preload.mjs"],
          timeout: 10,
          statusMessage: "Loading org memory",
        },
      ],
    });
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  console.log(`memos-os-mcp: wired into ${cwd}

  .mcp.json                        -> memos server registered (4 tools)
  .claude/hooks/memos-preload.mjs  -> installed
  .claude/settings.json            -> SessionStart hook registered

Set these, then restart your agent:

  MEMOS_API_URL=${API}
  MEMOS_AGENT_TOKEN=syn_...        (from your enrollment code)
  MEMOS_PROJECT_ID=project.your-project

The tools give your agent access to the org's memory. The hook is what makes it
actually arrive with that memory, instead of only being able to ask for it.
`);
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

async function serve() {
  if (!TOKEN) {
    // stderr, never stdout: stdout is the JSON-RPC channel and a stray byte corrupts the protocol.
    process.stderr.write("memos-os-mcp: MEMOS_AGENT_TOKEN is not set. Enroll an agent first.\n");
    process.exit(1);
  }

  const run = async (fn) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
    } catch (err) {
      // Returned as a result rather than thrown, so the model sees *why* and can correct itself.
      return { content: [{ type: "text", text: `MemOS rejected the call: ${err.message}` }], isError: true };
    }
  };
  const projectId = z.string().default(() => PROJECT ?? "").describe("Defaults to MEMOS_PROJECT_ID.");

  const server = new McpServer({ name: "memos", version: "0.1.0" });

  server.tool(
    "memos_learning_query",
    "Search the organisation's accumulated LEARNINGS by problem domain before solving something " +
      "yourself. Learnings are tagged by problem domain, never by project, so a lesson from another " +
      "team surfaces here. Call this FIRST on any non-trivial task.",
    {
      query: z.string().min(1),
      applies_to: z.array(z.string()).optional(),
      project_id: projectId,
      limit: z.number().int().positive().max(50).optional(),
    },
    (a) => run(() => intent("learning.query", a)),
  );

  server.tool(
    "memos_fact_query",
    "Search verified FACTS in a project — measurements, benchmarks, observed behaviour. Use when you " +
      "need a number someone already measured rather than a transferable lesson.",
    { query: z.string().min(1), project_id: projectId, limit: z.number().int().positive().max(50).optional() },
    (a) => run(() => intent("fact.query", a)),
  );

  server.tool(
    "memos_learning_record",
    "Record a reusable, non-obvious LEARNING for the rest of the org. Gated: at confidence medium or " +
      "high this REQUIRES an evidence_artifact_id from the same run and a non_obvious_marker of 15+ " +
      "characters. Those gates are enforced by the server, not here — if you have no evidence, record " +
      "at low confidence or not at all. Tag applies_to with problem domains, never product names.",
    {
      bd_id: z.string(),
      claim: z.string().min(1),
      applies_to: z.array(z.string().min(1)).min(1),
      confidence: z.enum(["low", "medium", "high"]),
      non_obvious_marker: z.string().optional(),
      evidence_artifact_id: z.string().optional(),
      project_id: projectId,
    },
    ({ project_id, bd_id, ...learning }) =>
      run(() => intent("learning.record", { project_id, bd_id, learnings: [learning] })),
  );

  server.tool(
    "memos_whoami",
    "Show which agent identity, org and project scopes this connection is authenticated as. Use to " +
      "confirm what you can read before assuming an empty result means nothing exists.",
    {},
    () => run(() => intent("agent.me", {})),
  );

  await server.connect(new StdioServerTransport());
}

const cmd = process.argv[2];
if (cmd === "init") init();
else if (!cmd || cmd === "serve") await serve();
else {
  process.stderr.write(`memos-os-mcp: unknown command "${cmd}". Use \`init\` or no argument to serve.\n`);
  process.exit(1);
}
