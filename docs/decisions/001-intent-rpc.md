# 001. Single intent-RPC endpoint over REST resources

- **Status:** accepted
- **Date:** 2026-06-14
- **Deciders:** Divyam Shah

## Context

MemOS exposes one API consumed primarily by **AI agents** (Claude Code, Cursor, CI bots) and secondarily by a human dashboard. The API must be (a) trivially legible to an LLM from a single manifest, (b) a single choke point for the cross-cutting concerns that are the product's whole value — auth, validation, rate limiting, trust scoring, audit logging, and the evidence/non-obvious gates — and (c) uniform enough that agent error-handling is mechanical. We are reverse-engineering a system (Synapse OS) whose own agent manifest is a flat list of verbs.

## Decision

Expose the entire API as a **single HTTP route, `POST /v1/intent/{intent.name}`**, dispatching to one handler per intent (`fact.record`, `learning.query`, `workflow.create`, …). Every response uses one uniform envelope: `{ ok: true, data }` on success, or `{ ok: false, error, detail, error_type }` on failure. Auth is a bearer token (`syn_...`) on every intent except `agent.enroll`. HTTP status carries transport/coarse meaning (200/400/401/403/429/5xx); the intent name carries the verb; the envelope carries the business outcome.

## Alternatives considered

- **REST resources (`GET/POST/PUT /facts`, `/learnings`, `/objectives/:id/milestones`, …).** Rejected: the cross-cutting concerns (gate enforcement, RLS context, trust, audit) would be re-implemented or wired as middleware across N route files with M methods each — more surface for a tenant-isolation bug, and no single manifest an agent can read. REST's noun-orientation also fits the agent's verb-oriented runbook poorly (the agent thinks "record a fact," not "POST to the facts collection").
- **GraphQL.** Rejected: a single endpoint and self-describing schema are attractive, but it optimizes for flexible client-shaped reads we don't need, pulls in resolver/N+1 complexity, and makes per-operation rate-limiting and the strict evidence-gate validation harder to pin down than one Zod schema per intent. Overkill for a fixed, smallish verb set.

## Consequences

- **Positive:** one place to enforce auth, rate-limit, validate (Zod per intent), set the RLS GUC, run the gates, and write the audit row. The whole API is one manifest file an agent reasons about. Uniform envelope ⇒ the agent's error handling is a single `if (!ok)` branch plus the status table.
- **Negative / tradeoffs:** we forgo HTTP-native semantics (caching on GET, conditional requests, method idempotency) — everything is POST. We must hand-build a dispatch registry and document each intent ourselves (no REST conventions to lean on). Observability tools that key on URL paths see one path; we add the intent name to logs/metrics to compensate.
- **Follow-ups:** the dispatch registry, envelope helper, and per-intent Zod schemas land in Phase 1; `docs/API.md` documents each intent as it is built; idempotency keys on writes are considered when the write path exists.
