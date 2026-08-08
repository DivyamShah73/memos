# memos-os-mcp

Give your coding agent access to your organisation's accumulated engineering knowledge — and make it
actually arrive with that knowledge, rather than merely being able to ask for it.

```bash
npx memos-os-mcp init
```

## Setup, end to end

**1. Get a token.** A manager or CEO mints a single-use enrollment code from the MemOS dashboard
(Admin page). Your agent exchanges it once:

```bash
curl -s -X POST $MEMOS_API_URL/v1/intent/agent.enroll \
  -H 'content-type: application/json' \
  -d '{"code":"<enrollment-code>","display_name":"my-agent"}'
```

The raw `syn_…` token is shown **once** — only its hash is stored.

**2. Set three variables.**

```bash
export MEMOS_API_URL=https://memos.your-org.com
export MEMOS_AGENT_TOKEN=syn_...
export MEMOS_PROJECT_ID=project.your-project
```

**3. Wire it in.**

```bash
npx memos-os-mcp init
```

That registers the MCP server in `.mcp.json` and installs a `SessionStart` hook. Restart your agent.

## What you get

**Four tools**

| Tool | Use |
|---|---|
| `memos_learning_query` | Search learnings by problem domain, before solving something yourself |
| `memos_fact_query` | Search verified measurements in a project |
| `memos_learning_record` | Publish a reusable learning back to the org |
| `memos_whoami` | Confirm identity and scopes |

**And a preload hook**, which is the part that matters.

Registering the tools makes MemOS *available*. It does not make an agent *use* it — the only nudge
is a tool description saying "call this first", and a tool description is a suggestion. It works
often; often is not a guarantee.

The `SessionStart` hook is not a suggestion. It runs before the agent's first token and injects the
project's learnings as context, so the fleet's knowledge is present whether or not the agent thought
to ask for it.

## The write gate is not in this package

`memos_learning_record` enforces nothing locally. A claim at confidence `medium` or `high` requires an
`evidence_artifact_id` from the same workflow run and a `non_obvious_marker` of 15+ characters — and
those checks live in the MemOS server's schema and database.

That is deliberate. A copy of the rule here would be a second copy to drift, and anyone writing
without going through this package would bypass it. The gate belongs at the boundary every writer
crosses.

## Failure behaviour

The hook **fails open, always.** No config, server unreachable, bad token, slow response — every path
exits silently and leaves your session exactly as it would have been. A memory layer that can break
your coding session when it is down is worse than no memory layer.

Tuning: `MEMOS_PRELOAD_LIMIT` (default 8) controls how many learnings are injected.

## Running the server directly

```bash
npx memos-os-mcp          # stdio JSON-RPC; this is what your agent invokes
```
