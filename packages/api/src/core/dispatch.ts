/**
 * The dispatch pipeline behind the single POST /v1/intent/{name} route.
 *
 * Order is deliberate (see ADR-001): auth is checked for any non-public intent BEFORE
 * we reveal whether the intent exists, so a tokenless call to ANY authed intent — even
 * an unimplemented one — returns 401, and nothing leaks the intent catalogue to
 * unauthenticated callers. A valid token + unknown intent falls through to 404.
 */
import { ZodError } from "zod";
import { registry } from "./registry.js";
import { ERROR_TYPE, fail, statusFor, type Envelope } from "./envelope.js";
import { extractBearer, resolveAgent, type AuthedAgent } from "./auth.js";
import { authorize } from "./authz.js";
import { resolveUserPrincipal } from "./users.js";
import { checkRateLimit } from "./ratelimit.js";
import { makeWithScope } from "./scope.js";
import type { IntentContext } from "./context.js";
import { gatewayDb } from "../db/gateway.js";

export interface DispatchInput {
  name: string;
  authHeader: string | null;
  rawBody: string;
  clientIp: string;
}

export interface DispatchOutput {
  status: number;
  body: Envelope;
  headers?: Record<string, string>;
}

function done(body: Envelope, headers?: Record<string, string>): DispatchOutput {
  return { status: statusFor(body), body, headers };
}

function validationEnvelope(err: ZodError): Envelope {
  const field_errors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join(".") : "(root)";
    (field_errors[key] ??= []).push(issue.message);
  }
  const first = err.issues[0];
  const first_error = first
    ? `${first.path.length ? first.path.join(".") : "(root)"}: ${first.message}`
    : "validation failed";
  return fail(first_error, ERROR_TYPE.validation, { field_errors, first_error });
}

export async function dispatch(input: DispatchInput): Promise<DispatchOutput> {
  // The WHOLE pipeline is wrapped so ANY unexpected throw — an auth-phase DB failure, a
  // handler throw, anything — still returns the uniform platform_error envelope and never
  // leaks Hono's bare "Internal Server Error" text (the envelope invariant must hold even
  // on failure; cf. docs/API.md 5xx -> platform_error).
  try {
    const entry = registry.get(input.name);
    const requiresAuth = entry ? entry.requiresAuth : true;

    // 1. Auth (before intent resolution) for non-public intents.
    let agent: AuthedAgent | null = null;
    if (requiresAuth) {
      const bearer = extractBearer(input.authHeader);
      if (!bearer) return done(fail("missing bearer token", ERROR_TYPE.unauthorized));
      // A bearer is either an agent token (agents table, by hash) or a dashboard user-session token
      // (users table, by hash). Both resolve to the same AuthedAgent principal shape so the rest of
      // the pipeline (org/project GUC, authz guard) is uniform (Phase 13/ADR-011).
      agent = (await resolveAgent(gatewayDb, bearer)) ?? (await resolveUserPrincipal(bearer));
      if (!agent) return done(fail("invalid or revoked token", ERROR_TYPE.unauthorized));
    }

    // 2. Rate limit (per token, or per connection IP for the public enroll call).
    const rlKey = agent ? `agent:${agent.id}` : `ip:${input.clientIp}`;
    const rl = checkRateLimit(rlKey);
    if (!rl.allowed) {
      return done(fail("rate limit exceeded", ERROR_TYPE.rateLimited), {
        "Retry-After": String(rl.retryAfterSec ?? 60),
      });
    }

    // 3. Unknown intent (only reachable once authed, so it doesn't leak to anon callers).
    if (!entry) return done(fail(`unknown intent: ${input.name}`, ERROR_TYPE.notFound));

    // 3.5 Authorization by role (Phase 12 / ADR-010) — after auth, before the handler. The role→
    // capability matrix lives in authz.ts; CEO is read-only, steering needs manager. Public intents
    // (agent === null) skip this — agent.enroll has no principal.
    if (agent) {
      const az = authorize(input.name, agent.role);
      if (!az.allowed) return done(fail(az.reason ?? "forbidden", ERROR_TYPE.forbidden));
    }

    // 4. Parse the JSON body (empty body is treated as {}; malformed is a 400, not a 500).
    let parsed: unknown;
    try {
      parsed = input.rawBody.trim() === "" ? {} : JSON.parse(input.rawBody);
    } catch {
      return done(
        fail("request body is not valid JSON", ERROR_TYPE.validation, {
          first_error: "body: invalid JSON",
        }),
      );
    }

    // 5. Schema validation → 400 with field_errors.
    const result = entry.schema.safeParse(parsed);
    if (!result.success) return done(validationEnvelope(result.error));

    // 6. Handler. Authed intents get an agent-bound `withScope` for RLS-protected tables.
    const ctx: IntentContext = { agent, db: gatewayDb, clientIp: input.clientIp };
    if (agent) {
      // Identity set for the briefs RLS policy: the agent's own id, its team, its org, and its
      // project scopes — every value a brief's target_id could match (ADR-006). Dedup + drop nulls.
      const identity = [
        ...new Set([agent.id, agent.teamId, agent.orgId, ...agent.scopes].filter(Boolean)),
      ] as string[];
      ctx.withScope = makeWithScope(gatewayDb, agent.scopes, identity, agent.orgId);
    }
    const body = await entry.handler(ctx, result.data as never);
    return done(body);
  } catch (err) {
    console.error(`dispatch error for intent ${input.name}:`, err);
    return done(fail("internal error", ERROR_TYPE.platform));
  }
}
