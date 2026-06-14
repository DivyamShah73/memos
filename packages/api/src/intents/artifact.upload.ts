/**
 * artifact.upload — stores evidence bytes in the blob store and records metadata. The bytes
 * NEVER touch Postgres; only bucket_path + sha256 + size do. Facts/learnings cite the returned
 * artifact_id to satisfy the evidence gate.
 *
 * Ordering matters: the blob is written BEFORE the row, and PutObject runs OUTSIDE the DB
 * transaction. A long S3 round-trip inside withScope would pin a pooled connection + locks;
 * and blob-before-row means the only possible orphan is a harmless unreferenced blob (GC-able),
 * never a row whose bucket_path points at nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ArtifactUploadInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { ensureBucket, putObject } from "../services/blobstore.js";
import { artifacts, workflowRuns } from "../db/schema.js";

// Decoded-artifact cap; the gateway bodyLimit (8 MiB) already bounds the base64 payload.
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export async function artifactUpload(
  ctx: IntentContext,
  input: ArtifactUploadInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, bd_id, kind, description, mime_type, content_base64 } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  // 1. Verify the run exists in this project (RLS hides another tenant's run).
  const runOk = await withScope(async (tx) => {
    const rows = await tx
      .select({ bdId: workflowRuns.bdId })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.bdId, bd_id), eq(workflowRuns.projectId, project_id)))
      .limit(1);
    return rows.length > 0;
  });
  if (!runOk) return fail("unknown workflow run", ERROR_TYPE.badRequest);

  // 2. Decode + size-check + hash (no DB, no blob yet).
  const bytes = Buffer.from(content_base64, "base64");
  if (bytes.length === 0) return fail("artifact is empty", ERROR_TYPE.badRequest);
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    return fail("artifact exceeds the size limit", ERROR_TYPE.badRequest);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = randomUUID();
  const bucketPath = `${project_id}/${id}`;

  // 3. Blob first (outside any tx).
  await ensureBucket();
  await putObject(bucketPath, bytes, mime_type);

  // 4. Then the metadata row (in scope).
  await withScope(async (tx) => {
    await tx.insert(artifacts).values({
      id,
      projectId: project_id,
      bdId: bd_id,
      kind,
      description: description ?? null,
      mimeType: mime_type,
      bucketPath,
      sizeBytes: bytes.length,
      sha256,
    });
  });

  return ok({ artifact_id: id, bucket_path: bucketPath, size_bytes: bytes.length, sha256 });
}
