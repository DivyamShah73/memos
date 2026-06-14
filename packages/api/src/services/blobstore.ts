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
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
