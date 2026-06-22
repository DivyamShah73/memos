/**
 * Full-text search builders (Phase 4). Centralizes the `'english'` regconfig so the query
 * expression byte-matches the gin index in 0006_fts_indexes.sql — if they ever drift, the
 * planner silently stops using the index. NOT a test (underscore prefix).
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** plainto_tsquery: treats input as plain text — no tsquery operators, no injection, no syntax errors. */
export const ftsQuery = (q: string): SQL => sql`plainto_tsquery('english', ${q})`;

export const ftsVector = (col: AnyPgColumn): SQL => sql`to_tsvector('english', ${col})`;

export const ftsRank = (col: AnyPgColumn, q: string): SQL<number> =>
  sql<number>`ts_rank(${ftsVector(col)}, ${ftsQuery(q)})`;
