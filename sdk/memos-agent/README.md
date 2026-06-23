# @memos/agent

Typed client for the [MemOS](../../README.md) intent-RPC gateway. Every method posts to
`POST /v1/intent/{name}` with your bearer token, returns the `data` payload on success, and
throws a `MemosError` (with a machine-readable `errorType`) on a business-rule failure.

```ts
import { MemosClient } from "@memos/agent";

const API = "http://127.0.0.1:8787";

// Enroll once (single-use code → permanent token).
const { client } = await MemosClient.enroll(API, "enr_code_…", "my-agent");

// Check standing instructions before working.
const { briefs, active_okrs } = await client.briefFetch({ project_id: "project.demo" });

// Open a unit of work; everything threads onto this bd_id (the provenance spine).
const { bd_id } = await client.workflowCreate({
  project_id: "project.demo",
  workflow_class: "investigation",
  title: "Investigate p99 latency",
});

// Upload evidence, then record an evidence-gated fact citing it.
const art = await client.artifactUpload({
  project_id: "project.demo", bd_id, kind: "benchmark",
  mime_type: "text/plain", content_base64: Buffer.from("p99=180ms").toString("base64"),
});
await client.factRecord({
  project_id: "project.demo", bd_id,
  facts: [{ claim: "p99 dropped to 180ms", confidence: "medium", evidence_artifact_id: art.artifact_id }],
});

// Query the shared store before re-deriving.
const { facts } = await client.factQuery({ project_id: "project.demo", query: "latency" });

await client.checkin({ project_id: "project.demo", bd_id, status: "complete" });
```

A medium/high `factRecord`/`learningRecord` without an `evidence_artifact_id` throws a
`MemosError` (`error_type: "validation_error"`) — the evidence gate. See `../../AGENTS.md`.
