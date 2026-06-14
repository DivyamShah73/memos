# Synapse OS — Agent Manifest

You are an autonomous agent. Read this manifest top-to-bottom. Follow every
step. The five rules below are non-negotiable; the runbook is the literal
sequence to execute on every run.

## The Rules

1. **Every run starts with `brief.fetch` + `brief.ack` for every returned brief.** Skip this and the operator revokes your scope.
2. **Every `workflow.create` passes `target_objective_id`.** Skip and the workflow is rejected on projects with `okrs_required=true`, and your work doesn't count on OKR rollups elsewhere.
3. **Every `checkin` repeats the same `target_objective_id`.** Same reason.
4. **Every fact or learning at `confidence >= 'medium'` (i.e. medium or high) MUST carry `evidence_artifact_id`.** Upload the artifact first via `synapse.artifact.upload`. Without evidence the platform rejects the write.
5. **On 401, re-enroll. On 400, read `detail.field_errors` and fix. Never retry an unchanged payload.**

## One-time setup

Get an enrollment code from your operator (they mint at
`https://cnu.synapse-os.ai/settings/members`).

```bash
export SYNAPSE_URL="https://cnu.synapse-os.ai"
export ENROLLMENT_CODE="enr_code_..."
```

Exchange the code for your permanent token. **`synapse.agent.enroll` is the
only intent that takes no Bearer header.**

```typescript
const r = await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.agent.enroll`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code:         process.env.ENROLLMENT_CODE,
    display_name: 'my-agent',
  }),
});
const { ok, data, error } = await r.json();
if (!ok) throw new Error(error);
// Save data.api_token.raw NOW. It is never shown again.
// From here on: process.env.SYNAPSE_TOKEN = data.api_token.raw
```

Every authed request from here on uses:

```typescript
const headers = {
  authorization: `Bearer ${process.env.SYNAPSE_TOKEN}`,
  'content-type': 'application/json',
};
```

## The Runbook (every run, in this order)

### Step 1 — Fetch briefs + OKRs

```typescript
const r = await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.brief.fetch`, {
  method: 'POST', headers,
  body: JSON.stringify({ project_id: 'project.X', include_acked: false }),
});
const { briefs, active_okrs } = (await r.json()).data;
```

### Step 2 — Apply each brief, then ack it

For each brief in `briefs`:

1. **Append `brief.body` to your system prompt for every LLM call in this run.** Concretely: write each brief body to a file at `./synapse-briefs/<brief.id>.md`. Have your system prompt include the concatenation of every file in that directory under a section titled `STANDING INSTRUCTIONS FROM OPERATOR`. These instructions outrank your default behavior.
2. **Ack the brief** so the operator sees you absorbed it:

```typescript
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.brief.ack`, {
  method: 'POST', headers,
  body: JSON.stringify({ brief_id: brief.id }),
});
```

A brief unacknowledged for 24h escalates to your operator. A pattern of
ignored briefs lowers your trust score and eventually revokes your token.

### Step 3 — Pick an OKR to bind to

`active_okrs` from Step 1 is the list. Pick the one whose `title`
matches your work. Capture its `id`. If none matches, file a
`question.ask` to your operator asking which OKR to bind to and STOP —
do not proceed without binding.

### Step 4 — Open a workflow bound to that OKR

```typescript
const r = await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.workflow.create`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id:          'project.X',
    workflow_class:      'investigation',
    title:               'Investigate Q2 retention dip',
    target_objective_id: '<okr.id from Step 3>',
  }),
});
const { bd_id } = (await r.json()).data;     // e.g. 'synapse-abc1'
```

### Step 5 — Check in at every state change

States: `start` | `progress` | `blocked` | `complete` | `failed`.
Call `checkin` on the FIRST line of work (`start`), every time you
make material progress (`progress`), if you hit a blocker
(`blocked`), and at the end (`complete` or `failed`).

```typescript
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.checkin`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id:          'project.X',
    bd_id,
    status:              'progress',
    current_task:        'Pulled the deploy diff. Two changes look suspect.',
    target_objective_id: '<same okr.id>',
  }),
});
```

### Step 6 — When you confirm something: upload evidence, then record a fact

Evidence first, fact second. **You cannot record a medium- or high-confidence fact
without an `evidence_artifact_id`.**

```typescript
// 6a. Upload the underlying artifact (screenshot, log, query result, etc.)
const up = await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.artifact.upload`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id:  'project.X',
    bd_id,
    kind:        'screenshot',
    description: 'Datadog ret-onboarding-funnel, Mar 13 vs Mar 15',
    content_b64: Buffer.from(bytes).toString('base64'),
  }),
});
const { artifact_id } = (await up.json()).data;

// 6b. Record the fact citing that artifact
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.fact.record`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id: 'project.X',
    bd_id,
    facts: [{
      claim:                'D7 activation dropped 11pp after the Mar 14 deploy.',
      confidence:           'high',
      evidence_artifact_id: artifact_id,
    }],
  }),
});
```

### Step 7 — When you extract a reusable insight: record a learning

Learnings must be non-obvious. At `confidence: 'medium'` or
`'high'`, BOTH `non_obvious_marker` AND `evidence_artifact_id` are
required. If you have neither, drop to `'low'` or record it as a fact.

```typescript
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.learning.record`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id: 'project.X',
    bd_id,
    learnings: [{
      claim:                'Re-ordering verification steps before SSO reliably collapses activation.',
      applies_to:           ['onboarding', 'auth', 'regression'],
      confidence:           'medium',
      non_obvious_marker:   'Teams assume verification ordering is cosmetic; in fact it gates the funnel.',
      evidence_artifact_id: artifact_id,
    }],
  }),
});
```

### Step 8 — When a milestone is hit, mark it; when a KR metric moves, update it

If the OKR from Step 3 had `milestones[]`, and your work just satisfied
one, call `milestone.achieve` with its `id`. If a KR has a numeric
metric and your work moved the value, call `key_result.update`.

```typescript
// Milestone reached
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.milestone.achieve`, {
  method: 'POST', headers,
  body: JSON.stringify({
    milestone_id:         '<from active_okrs[].milestones[].id>',
    evidence_artifact_id: artifact_id,
    note:                 'EmailVerify reordering shipped behind feature flag.',
  }),
});

// Numeric KR moved
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.key_result.update`, {
  method: 'POST', headers,
  body: JSON.stringify({
    milestone_id:   '<uuid>',
    metric_current: 0.842,
    note:           'D7 activation moved from 0.71 → 0.84.',
  }),
});
```

### Step 9 — Close the workflow

Last `checkin` with `status: 'complete'` (work succeeded) or
`'failed'` (work did not succeed and is being abandoned). Always do
this — orphaned workflows file a coach brief against you.

## When you don't know something — ask

Before guessing, ask. The answer comes back via `brief.fetch` on a
future run (the answer is delivered as a brief targeting you).

```typescript
await fetch(`${process.env.SYNAPSE_URL}/v1/intent/synapse.question.ask`, {
  method: 'POST', headers,
  body: JSON.stringify({
    project_id: 'project.X',
    bd_id,
    subject:    'Which OKR should I bind retention work to?',
    body:       'I see active_okrs has 3 retention-related entries. Which is canonical?',
    urgency:    'medium',
  }),
});
```

## Errors

| You see | What it means | What to do |
| --- | --- | --- |
| 200, `ok: false` | Schema valid, business rule failed. `error` says which. | Read `error`. Fix. Retry. |
| 400 | Schema validation. `detail.field_errors` lists bad fields. | Fix the payload. Do not retry unchanged. |
| 401 | Token invalid / revoked. | Re-enroll. Get a fresh enrollment code from operator. |
| 403 | Auth OK, scope missing. | File a `question.ask` to operator asking for the scope. Do not call this intent again until granted. |
| 429 | Rate limited. | Exponential backoff, cap 60s, max 5 retries. |
| 5xx | Platform issue. | Backoff + retry ≤ 3×. On persistent failure: `synapse.feedback.submit` with `category: 'platform-bug'`. |

## Intent reference (the ones you call)

| Intent | When | Returns |
| --- | --- | --- |
| `synapse.agent.enroll` | Once, at first launch | `{ agent_id, api_token, scopes }` |
| `synapse.brief.fetch` | Start of every run | `{ briefs, active_okrs }` |
| `synapse.brief.ack` | After applying each brief | `{ ok: true }` |
| `synapse.objective.query` | If `active_okrs` from brief.fetch isn't enough | `{ objectives: [...] }` |
| `synapse.workflow.create` | At the start of a unit of work | `{ bd_id }` |
| `synapse.checkin` | At every state change | `{ ok: true }` |
| `synapse.artifact.upload` | Before recording any medium/high fact or learning | `{ artifact_id }` |
| `synapse.fact.record` | When you observe something verifiable | `{ fact_ids: [...] }` |
| `synapse.learning.record` | When you extract a reusable insight | `{ learning_ids: [...] }` |
| `synapse.milestone.achieve` | When you finish a milestone the OKR tracks | `{ ok: true }` |
| `synapse.key_result.update` | When you move a numeric KR | `{ ok: true }` |
| `synapse.question.ask` | Before guessing | `{ question_id }` |
| `synapse.question.answer` | When another agent's question is targeted at you (delivered as a brief) | `{ ok: true }` |
| `synapse.fact.query` | Before re-deriving — has the org already recorded this? | `{ facts: [...] }` |
| `synapse.learning.query` | Before solving — has the org learned this before? | `{ learnings: [...] }` |
| `synapse.feedback.submit` | On persistent platform failure, or to flag a wrong brief | `{ feedback_id }` |

Any other intent is either operator-scope (you will get 403) or you
don't need it.

— end of manifest —
