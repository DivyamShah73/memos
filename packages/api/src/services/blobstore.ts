/**
 * MinIO/S3 blob store for evidence artifacts. The DB only ever holds the bucket_path +
 * sha256 + size; the bytes live here. S3-compatible via @aws-sdk/client-s3.
 *
 * Side-effect-free at import (no bucket creation, no connection) so typecheck and non-blob
 * code don't need MinIO up. The bucket is created lazily + once on first upload.
 */
import "../env.js"; // load the repo-root .env
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const BUCKET = process.env.MINIO_BUCKET ?? "memos-artifacts";

const client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000",
  region: process.env.MINIO_REGION ?? "us-east-1",
  forcePathStyle: true, // required for MinIO (no virtual-host-style buckets)
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER ?? "minioadmin",
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? "minioadmin",
  },
});

let bucketReady: Promise<void> | undefined;

/** Create the bucket if absent. Memoized so concurrent first-uploads share one call. */
export function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = client
      .send(new CreateBucketCommand({ Bucket: BUCKET }))
      .then(() => undefined)
      .catch((err: { name?: string; Code?: string }) => {
        const code = err.name ?? err.Code;
        if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") return;
        bucketReady = undefined; // a real failure → let the next call retry
        throw err;
      });
  }
  return bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`blob store returned no body for key: ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * True if `err` looks like the blob store being unreachable or misconfigured (rather than a
 * per-request application error). Covers the common prod case: no MINIO_* env vars set, so the
 * client falls back to localhost:9000 and the connection is refused. Also catches DNS/timeout
 * failures against a real endpoint and credential/permission rejections from the store. Lets
 * artifact.upload return a clear 503 ("storage unavailable/not configured") instead of an opaque
 * 500 — the operator then knows to configure the store (see docs/DEPLOY.md), not debug the app.
 */
export function isBlobStoreUnavailable(err: unknown): boolean {
  const e = err as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
  const code = e?.code ?? e?.name ?? "";
  // Node/undici socket-level failures (no store listening, DNS/timeout).
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  // AWS SDK infra/credential failures (bad endpoint, wrong keys, forbidden) — a config problem,
  // not a client mistake we should surface as a 500.
  if (
    code === "TimeoutError" ||
    code === "AccessDenied" ||
    code === "InvalidAccessKeyId" ||
    code === "SignatureDoesNotMatch"
  ) {
    return true;
  }
  const status = e?.$metadata?.httpStatusCode;
  return status === 403 || (typeof status === "number" && status >= 500);
}
