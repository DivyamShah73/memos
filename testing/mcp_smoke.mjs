/**
 * Smoke test for the MemOS MCP server. Speaks JSON-RPC over stdio exactly as Claude Code does, so it
 * proves the real transport rather than importing the module and calling functions directly.
 *
 * Needs the gateway up:
 *   docker compose up -d db minio && pnpm db:migrate && pnpm db:seed && pnpm dev:api
 *
 *   node testing/mcp_smoke.mjs
 */
import { spawn } from "node:child_process";

// The seed's fixed operator token, not a real credential — every `pnpm db:seed` prints this exact
// string. The suppression marker has to sit on the matching line itself, not the comment above it.
const TOKEN = process.env.MEMOS_AGENT_TOKEN ?? "syn_demo_operator_0000000000000000"; // memos-allow-example
const PROJECT = process.env.MEMOS_PROJECT_ID ?? "project.demo";

const child = spawn("node", ["sdk/memos-mcp/bin/cli.mjs"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, MEMOS_AGENT_TOKEN: TOKEN, MEMOS_PROJECT_ID: PROJECT },
  });

let buf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* not JSON-RPC (tsx banner etc.) — ignore */
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let nextId = 1;
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 25000);
  });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const text = (res) => res?.result?.content?.[0]?.text ?? "";

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "0" },
});
check("initialize handshake", init.result?.serverInfo?.name === "memos", JSON.stringify(init.result));
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const tools = await send("tools/list", {});
const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
check(`tools/list returns 4 tools (${names.join(", ")})`, names.length === 4);

const who = await send("tools/call", { name: "memos_whoami", arguments: {} });
check("memos_whoami authenticates", !who.result?.isError, text(who).slice(0, 200));

const q = await send("tools/call", {
  name: "memos_learning_query",
  arguments: { query: "latency" },
});
check("memos_learning_query returns learnings", !q.result?.isError && text(q).includes("learnings"), text(q).slice(0, 200));

// The point of the whole exercise: the agent is subject to the product's write gate, and the refusal
// comes back as a readable reason rather than a crash.
const gated = await send("tools/call", {
  name: "memos_learning_record",
  arguments: {
    bd_id: "memos-demo",
    claim: "unbacked claim that should be refused",
    applies_to: ["vllm-deployment"],
    confidence: "high",
  },
});
check(
  "evidence gate REJECTS a high-confidence write with no artifact",
  gated.result?.isError === true && /evidence/i.test(text(gated)),
  text(gated).slice(0, 240),
);

console.log(`\n${pass} passed, ${fail} failed`);
child.kill();
process.exit(fail === 0 ? 0 : 1);
