---
name: design-review
description: Run an HLD + LLD design review on a proposed plan BEFORE coding a non-trivial MemOS feature. Use at the start of any feature that touches more than one module, the data model, or a core invariant.
---

# MemOS Design Review (HLD + LLD)

Before building a non-trivial feature, produce a short design review the human can approve. This is where system-design judgment is shown and captured. Keep it tight — one page — but cover both altitudes.

## Produce these sections

### 1. Problem & scope (2-3 sentences)
What are we building and why. What's explicitly out of scope.

### 2. HLD — how it fits the system
- Which components touch this (gateway / workers / web / db / blob / queue)?
- Data flow: trace one request end-to-end (who calls → what's validated → what's written → what's returned → any async follow-up).
- Failure modes: what happens on partial failure, retry, or concurrent writes.

### 3. LLD — the concrete design
- New/changed tables, columns, indexes (reference `db-migration` skill).
- New/changed intents (reference `scaffold-intent` skill).
- Key types/interfaces.
- The core invariants this feature must preserve (evidence gate, RLS isolation, provenance thread) and HOW it preserves them.

### 4. Alternatives considered
At least one alternative and why you rejected it. This is the senior-engineer signal.

### 5. Risks & open questions
Anything that could bite: scaling, cost (embeddings!), race conditions, migration safety.

### 6. Test plan
What invariant tests prove this works. What's the demo that shows it.

## After approval
- If this was a real architectural decision, capture it with the `write-adr` skill.
- Then proceed to implementation (use `scaffold-intent` / `db-migration` / `frontend-component` as appropriate).

## Done when
The human has read the review and approved (or redirected). Do NOT start coding a multi-module feature without this.
