---
name: evidence-gate-check
description: Audit that the MemOS core write-gating invariants (evidence gate, non-obvious gate, provenance thread, tenant isolation) are actually enforced and tested. Run before merging any change to the fact/learning/artifact/workflow write path.
---

# Evidence-Gate & Invariant Check

The product's entire value depends on the store staying clean. These invariants are the difference between a useful shared memory and a junk drawer. This skill verifies they're enforced — in code AND in tests — not just documented.

## The invariants (verify each is ENFORCED and TESTED)

### 1. Evidence gate
A `fact` or `learning` with `confidence in (medium, high)` MUST have a non-null `evidence_artifact_id`.
- [ ] Enforced in the Zod schema (`superRefine`).
- [ ] Re-checked in the handler (defense in depth).
- [ ] Test: medium-confidence write without evidence → rejected with a clear error.
- [ ] Test: high-confidence write without evidence → rejected.
- [ ] Test: low-confidence without evidence → ACCEPTED (low is allowed unbacked).

### 2. Non-obvious gate (learnings only)
A `learning` with `confidence >= medium` MUST have `non_obvious_marker` length >= 15.
- [ ] Enforced in schema + handler.
- [ ] Test: medium learning with no/short marker → rejected.

### 3. Artifact-before-write ordering
`evidence_artifact_id` must reference an artifact that EXISTS and belongs to the same project/bd_id.
- [ ] Handler validates the artifact exists and is same-tenant (no cross-tenant evidence borrowing).
- [ ] Test: citing a non-existent or foreign artifact_id → rejected.

### 4. Provenance thread
Every fact/learning/artifact/checkin carries a valid `bd_id`; every workflow_run on an `okrs_required` project carries a non-abandoned `target_objective_id`.
- [ ] FK constraints exist.
- [ ] Test: workflow.create binding an abandoned objective → rejected ("cannot bind").
- [ ] Test: writing a fact with an unknown bd_id → rejected.

### 5. Tenant isolation
- [ ] RLS policies on facts, learnings, artifacts, workflow_runs, objectives.
- [ ] Test: agent scoped to project A cannot read/write project B's rows (even with a valid bd_id from B).

### 6. `applies_to` hygiene (soft — warn, don't block)
- [ ] A check (lint or critic) flags learnings whose `applies_to` contains a known project/team slug instead of a problem-domain term.

## How to run
1. Read the relevant schema + handler + test files.
2. For each unchecked box, either point to the line that enforces/tests it, or flag it as a gap.
3. For any gap, propose the missing schema rule, handler check, or test — and add it.

## Done when
Every box is checked with a code/test reference, or the gaps are fixed in this change. A write-path PR does not merge with an open box.
