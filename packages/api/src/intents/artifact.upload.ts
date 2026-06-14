/**
 * artifact.upload — stores evidence bytes in the blob store and records metadata. The bytes
 * NEVER touch Postgres; only bucket_path + sha256 + size do. Facts/learnings cite the returned
 * artifact_id to satisfy the evidence gate.
 *
 * Ordering matters: the blob is written BEFORE the row, and PutObject runs OUTSIDE the DB
 * transaction. A long S3 round-trip inside withScope would pin a pooled connection + locks;
 * and blob-before-row means the only possible orphan is a harmless unreferenced blob (GC-able),
 * never a row whose bucket_path points at nothing. The run-existence check runs first (a cheap
 * tx) so a bad run never causes a wasted blob upload.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ArtifactUploadInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { isRlsViolation } from "../core/pgerrors.js";
import { ensureBucket, putObject } from "../services/blobstore.js";
import { assertRunWritable } from "./_evidence.js";
import { artifacts } from "../db/schema.js";

// Secondary decoded-size backstop. The gateway bodyLimit (8 MiB) bounds the base64+JSON
// REQUEST, so the effective decoded cap is already ~6 MiB; this only bites if that limit is
// later raised without revisiting it.
const MAX_ARTIFACT_BYTES = 6 * 1024 * 1024;

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

  try {
    // 1. Verify the run exists in this project and is open (RLS hides another tenant's run).
    const runCheck = await withScope((tx) => assertRunWritable(tx, project_id, bd_id));
    if (!runCheck.ok) return fail(runCheck.message, ERROR_TYPE.badRequest);

    // 2. Decode + size-check + hash (the schema guarantees non-empty, valid base64).
    const bytes = Buffer.from(content_base64, "base64");
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
  } catch (err) {
    if (isRlsViolation(err)) {
      return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
    }
    throw err;
  }
}
