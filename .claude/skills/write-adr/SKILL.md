---
name: write-adr
description: Capture an Architecture Decision Record for a real design choice in MemOS. Use whenever a non-trivial decision is made (tech choice, schema modeling, isolation strategy, a tradeoff with alternatives).
---

# Write an ADR (Architecture Decision Record)

ADRs are how this project proves the human DROVE the architecture, not just accepted defaults. They're short, durable, and interview-gold. Write one whenever a decision had real alternatives.

## Format — `docs/decisions/NNN-kebab-title.md`

Use the next number in sequence. Keep it under one page.

```markdown
# NNN. <Title>

- **Status:** accepted | superseded by NNN | proposed
- **Date:** YYYY-MM-DD
- **Deciders:** <you>

## Context
What problem/force prompted this decision? What constraints (time, skill-showcase goal, scale target) apply? 2-4 sentences.

## Decision
What we chose, stated plainly. One paragraph.

## Alternatives considered
- **Option B:** what it was, why rejected.
- **Option C:** what it was, why rejected.
(At least one real alternative. This is the part that matters.)

## Consequences
- Positive: what this buys us.
- Negative / tradeoffs: what it costs, what we'll have to watch.
- Follow-ups: anything this forces later.
```

## Decisions that DESERVE an ADR in this project
- Intent-RPC single endpoint vs REST resources.
- RLS-at-DB vs handler-only multi-tenancy.
- One `milestones` table serving both KR and milestone roles.
- Postgres FTS first, pgvector later (and the embedding-cost tradeoff).
- Evidence-gate enforced in schema + handler + test (defense in depth).
- Critic agents as scheduled workers vs inline validation.
- Monorepo vs polyrepo.
- TypeScript end-to-end vs polyglot.

## Done when
The ADR exists, is numbered correctly, and names at least one real alternative with the reason it lost. Reference it from `docs/ARCHITECTURE.md` if it's foundational.
