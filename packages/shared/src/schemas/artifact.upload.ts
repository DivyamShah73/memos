import { z } from "zod";

// Buffer.from(s, "base64") is silently lenient (drops junk → wrong bytes/sha256), so
// validate the encoding up front.
const base64String = z
  .string()
  .min(1, "is required")
  .refine((s) => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s), "must be valid base64");

/**
 * Input for `artifact.upload` — stores evidence bytes in the blob store; only metadata
 * (bucket_path, size_bytes, sha256) lands in Postgres. The bytes themselves never do.
 */
export const artifactUploadInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  bd_id: z.string().min(1, "is required"),
  kind: z.string().min(1, "is required"), // log | screenshot | query_result | benchmark | ...
  description: z.string().optional(),
  mime_type: z.string().min(1, "is required"),
  content_base64: base64String,
});

export type ArtifactUploadInput = z.infer<typeof artifactUploadInputSchema>;
