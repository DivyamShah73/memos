/**
 * The uniform response envelope (PROJECT_DOC §4.1). Every intent returns one of these;
 * handlers never throw raw to the client. HTTP status is derived from the envelope.
 */

export const ERROR_TYPE = {
  validation: "validation_error",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
  rateLimited: "rate_limited",
  badRequest: "bad_request", // business-rule failure → HTTP 200 with ok:false
  platform: "platform_error",
} as const;

export type ErrorType = (typeof ERROR_TYPE)[keyof typeof ERROR_TYPE];

export type Envelope =
  | { ok: true; data: unknown }
  | { ok: false; error: string; detail: Record<string, unknown>; error_type: ErrorType };

export function ok(data: unknown): Envelope {
  return { ok: true, data };
}

export function fail(
  error: string,
  error_type: ErrorType,
  detail: Record<string, unknown> = {},
): Envelope {
  return { ok: false, error, detail, error_type };
}

/**
 * Map an envelope to its HTTP status. Note the deliberate split (PROJECT_DOC §4.1):
 * a *business-rule* failure (bad_request) is HTTP 200 with ok:false — the agent reads
 * `error` and retries with a fix. Only schema/transport/auth failures are non-200.
 */
export function statusFor(env: Envelope): number {
  if (env.ok) return 200;
  switch (env.error_type) {
    case "validation_error":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "platform_error":
      return 500;
    case "bad_request":
      return 200;
    default:
      return 200;
  }
}
