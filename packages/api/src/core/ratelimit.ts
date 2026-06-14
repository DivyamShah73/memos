/**
 * Per-token rate-limit STUB (Phase 1). In-memory fixed-window counter keyed by token
 * (or client IP for the public enroll call). This is intentionally minimal and
 * per-process — a Redis-backed, horizontally-shared limiter lands in Phase 6. The limit
 * is set very high under test so the suite never trips it.
 */
interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
// Bound the Map so it can't grow without limit (one entry per distinct key forever).
// When it hits the cap we sweep expired windows before inserting a new key.
const MAX_BUCKETS = 50_000;
const buckets = new Map<string, Window>();

function sweepExpired(now: number): void {
  for (const [k, w] of buckets) {
    if (now >= w.resetAt) buckets.delete(k);
  }
}

function limit(): number {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return 1_000_000;
  const fromEnv = Number(process.env.MEMOS_RATE_LIMIT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600;
}

export interface RateResult {
  allowed: boolean;
  retryAfterSec?: number;
}

export function checkRateLimit(key: string): RateResult {
  const now = Date.now();
  const max = limit();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    if (buckets.size >= MAX_BUCKETS) sweepExpired(now);
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  if (w.count >= max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { allowed: true };
}
