/**
 * Unit tests for the blob-store availability classifier + the 503 envelope mapping (the
 * artifact.upload clear-error fix). Pure functions — no MinIO/S3 needed, so these run anywhere.
 */
import { describe, expect, it } from "vitest";
import { isBlobStoreUnavailable } from "./blobstore.js";
import { ERROR_TYPE, fail, statusFor } from "../core/envelope.js";

describe("isBlobStoreUnavailable", () => {
  it("flags socket-level failures (the prod 'no MINIO_* → localhost refused' case)", () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"]) {
      expect(isBlobStoreUnavailable({ code })).toBe(true);
    }
  });

  it("flags AWS SDK infra/credential failures (bad endpoint or keys — a config problem)", () => {
    for (const name of ["TimeoutError", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"]) {
      expect(isBlobStoreUnavailable({ name })).toBe(true);
    }
    expect(isBlobStoreUnavailable({ $metadata: { httpStatusCode: 403 } })).toBe(true);
    expect(isBlobStoreUnavailable({ $metadata: { httpStatusCode: 503 } })).toBe(true);
  });

  it("does NOT flag ordinary application errors (so real bugs still surface as 500)", () => {
    expect(isBlobStoreUnavailable(new Error("some logic bug"))).toBe(false);
    expect(isBlobStoreUnavailable({ code: "23505" })).toBe(false); // a pg unique-violation
    expect(isBlobStoreUnavailable({ $metadata: { httpStatusCode: 404 } })).toBe(false);
    expect(isBlobStoreUnavailable(null)).toBe(false);
    expect(isBlobStoreUnavailable(undefined)).toBe(false);
  });
});

describe("service_unavailable envelope", () => {
  it("maps to HTTP 503", () => {
    const env = fail("artifact storage is unavailable or not configured", ERROR_TYPE.unavailable);
    expect(statusFor(env)).toBe(503);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error_type).toBe("service_unavailable");
  });
});
