/** Postgres SQLSTATE classifiers used by handlers to branch on DB errors. */

/** 23505 unique_violation — e.g. a PK/unique-index collision (retry with a new id). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

/** 42501 insufficient_privilege — an RLS WITH CHECK rejected the row (out of scope). */
export function isRlsViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "42501";
}
