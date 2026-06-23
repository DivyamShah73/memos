/**
 * MemOS — canonical database schema (Drizzle, Postgres flavor).
 *
 * This file is the SOURCE OF TRUTH for the data model; docs/DATA_MODEL.md documents
 * the "why" and may lag. Migrations are generated from here via `drizzle-kit generate`
 * and applied by src/db/migrate.ts.
 *
 * Conventions (see CLAUDE.md):
 *  - text PKs for human-readable public slugs: org / team.<slug> / project.<slug> /
 *    agent.<slug> / workflow_runs.bd_id (memos-<short>). uuid PKs for everything else.
 *  - Every tenant-scoped table carries `project_id`; RLS policies key on it
 *    (see infra/migrations/0002_rls.sql). milestones & choices get a denormalized
 *    project_id (the doc scopes them indirectly) so the uniform RLS template applies.
 *  - facts/learnings carry a nullable vector(1536) embedding; the HNSW index and the
 *    FTS gin indexes are DEFERRED to Phase 4 (no consumer until the query phase).
 *  - All text is UTF-8 clean (no enum mangling of ≤ — 🎯).
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  numeric,
  bigint,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ helpers */

// Standard creation timestamp: tz-aware, server-defaulted, never null.
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/* ===================================================================== *
 * 1. Tenancy: orgs → teams → projects
 * ===================================================================== */

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(), // 'org'
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(), // 'team.<slug>'
  orgId: text("org_id").references(() => orgs.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(), // 'project.<slug>' — public, used in every agent call
  uuid: uuid("uuid").defaultRandom().notNull().unique(),
  teamId: text("team_id").references(() => teams.id),
  // Denormalized org owner (Phase 11). Lets multi-org isolation + the auth-bootstrap org
  // resolution key on a single row without a teams join. Backfilled from team→org in 0008.
  orgId: text("org_id")
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  // If true, workflow.create REQUIRES a non-abandoned target_objective_id (Phase 2).
  okrsRequired: boolean("okrs_required").default(false).notNull(),
  createdAt: createdAt(),
});

/* ===================================================================== *
 * 2. Agents + enrollment codes (control-plane; NOT project-scoped → no RLS)
 * ===================================================================== */

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(), // 'agent.<slug>'
    displayName: text("display_name").notNull(),
    apiTokenHash: text("api_token_hash").notNull(), // store HASH only; raw syn_... shown once
    teamId: text("team_id").references(() => teams.id),
    // Denormalized so resolveAgent gets the agent's org from a single by-token-hash row (no
    // teams join), which is what lets control-plane tables be org-RLS'd without an auth deadlock.
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Authorization role (Phase 12 / ADR-010): member (contribute), manager (steer: OKRs/briefs),
    // ceo (read-only org-wide). Inherited from the enrollment code; the dispatch guard enforces it.
    role: text("role").notNull().default("member"),
    trustScore: numeric("trust_score").notNull().default("0.5"), // 0..1
    status: text("status").notNull().default("active"), // active | revoked
    lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Auth hashes the bearer and looks the agent up by this column on every request,
    // so it must be indexed; unique because two agents can never share a token hash.
    uniqueIndex("agents_api_token_hash_idx").on(t.apiTokenHash),
    check("agents_status_check", sql`${t.status} in ('active','revoked')`),
    check("agents_role_check", sql`${t.role} in ('member','manager','ceo')`),
  ],
);

export const enrollmentCodes = pgTable(
  "enrollment_codes",
  {
    code: text("code").primaryKey(), // 'enr_code_...'; single-use, consumed on enroll
    teamId: text("team_id").references(() => teams.id),
    // Denormalized so enroll stamps the new agent's org_id from the code row alone (no teams read).
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Role the enrolled agent inherits (Phase 12). Managers mint manager/member codes (Phase 14).
    role: text("role").notNull().default("member"),
    usedBy: text("used_by"), // agent id once redeemed
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check("enrollment_codes_role_check", sql`${t.role} in ('member','manager','ceo')`)],
);

/* ===================================================================== *
 * 3. Objectives (OKRs) + milestones (KR/milestone, one table two roles)
 * ===================================================================== */

export const objectives = pgTable(
  "objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    bdId: text("bd_id"), // run that created it; null for bootstrap OKRs
    agentId: text("agent_id"), // creator
    parentId: uuid("parent_id").references((): AnyPgColumn => objectives.id), // sub-OKR
    weight: numeric("weight"), // sub-OKR contribution weight
    title: text("title").notNull(),
    description: text("description"),
    targetCompletion: timestamp("target_completion", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active|achieved|abandoned|superseded
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => objectives.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("objectives_project_status_idx").on(t.projectId, t.status),
    index("objectives_parent_idx").on(t.parentId),
    check(
      "objectives_status_check",
      sql`${t.status} in ('active','achieved','abandoned','superseded')`,
    ),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectiveId: uuid("objective_id")
      .notNull()
      .references(() => objectives.id),
    // Denormalized from the parent objective so the project_id RLS template applies
    // uniformly (the doc scopes milestones indirectly via objective_id).
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position"), // ordering within the objective
    status: text("status").notNull().default("pending"), // pending | achieved
    metricTarget: numeric("metric_target"),
    metricCurrent: numeric("metric_current"),
    metricUnit: text("metric_unit"), // 'percent' | 'cents per piece' | 'seconds' | 'USD'
    metricDirection: text("metric_direction"), // up (higher better) | down (lower better)
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    // snapshot {claim, confidence, evidence_artifact_id, achieved_at, agent_id}
    achievement: jsonb("achievement"),
  },
  (t) => [
    index("milestones_objective_position_idx").on(t.objectiveId, t.position),
    check("milestones_status_check", sql`${t.status} in ('pending','achieved')`),
    check(
      "milestones_direction_check",
      sql`${t.metricDirection} is null or ${t.metricDirection} in ('up','down')`,
    ),
  ],
);

/* ===================================================================== *
 * 4. Workflow runs (the bd_id provenance spine) + checkins
 * ===================================================================== */

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    bdId: text("bd_id").primaryKey(), // 'memos-<short>'
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    agentId: text("agent_id").references(() => agents.id),
    workflowClass: text("workflow_class"), // investigation | sft-experiment | okr-update | ...
    title: text("title").notNull(),
    targetObjectiveId: uuid("target_objective_id").references(() => objectives.id), // req'd if okrs_required
    status: text("status").notNull().default("open"), // open | complete | failed
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_runs_project_status_idx").on(t.projectId, t.status),
    index("workflow_runs_target_objective_idx").on(t.targetObjectiveId),
    check("workflow_runs_status_check", sql`${t.status} in ('open','complete','failed')`),
  ],
);

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdId: text("bd_id")
      .notNull()
      .references(() => workflowRuns.bdId),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    // FK to objectives like workflow_runs.target_objective_id — a DB backstop so this
    // provenance column can never hold a dangling/foreign objective id.
    targetObjectiveId: uuid("target_objective_id").references(() => objectives.id),
    status: text("status").notNull(), // start | progress | blocked | complete | failed
    currentTask: text("current_task"),
    createdAt: createdAt(),
  },
  (t) => [
    index("checkins_bd_created_idx").on(t.bdId, t.createdAt),
    check(
      "checkins_status_check",
      sql`${t.status} in ('start','progress','blocked','complete','failed')`,
    ),
  ],
);

/* ===================================================================== *
 * 5. Knowledge: artifacts (evidence) ← facts / learnings cite via FK
 * ===================================================================== */

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    bdId: text("bd_id")
      .notNull()
      .references(() => workflowRuns.bdId),
    kind: text("kind"), // log | screenshot | query_result | benchmark | ...
    description: text("description"),
    mimeType: text("mime_type"),
    bucketPath: text("bucket_path"), // '{project_id}/{artifact_uuid}' — bytes live in MinIO
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_project_bd_idx").on(t.projectId, t.bdId)],
);

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    bdId: text("bd_id")
      .notNull()
      .references(() => workflowRuns.bdId),
    agentId: text("agent_id").references(() => agents.id),
    claim: text("claim").notNull(),
    confidence: text("confidence").notNull(), // low | medium | high
    status: text("status").notNull().default("active"), // active | retracted | superseded
    // REQUIRED (enforced in schema gate + handler) when confidence >= medium.
    evidenceArtifactId: uuid("evidence_artifact_id").references(() => artifacts.id),
    embedding: vector("embedding", { dimensions: 1536 }), // Phase 4: HNSW index deferred
    createdAt: createdAt(),
  },
  (t) => [
    index("facts_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("facts_bd_idx").on(t.bdId),
    check("facts_confidence_check", sql`${t.confidence} in ('low','medium','high')`),
    check("facts_status_check", sql`${t.status} in ('active','retracted','superseded')`),
  ],
);

export const learnings = pgTable(
  "learnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    bdId: text("bd_id")
      .notNull()
      .references(() => workflowRuns.bdId),
    agentId: text("agent_id").references(() => agents.id),
    claim: text("claim").notNull(),
    appliesTo: text("applies_to").array().notNull(), // 3-5 problem-domain tags, NOT project names
    confidence: text("confidence").notNull(), // low | medium | high
    // REQUIRED (>=15 chars) when confidence >= medium — the non-obvious gate.
    nonObviousMarker: text("non_obvious_marker"),
    // REQUIRED when confidence >= medium — the evidence gate.
    evidenceArtifactId: uuid("evidence_artifact_id").references(() => artifacts.id),
    status: text("status").notNull().default("active"),
    dokGrade: text("dok_grade").notNull().default("ungraded"), // ungraded | DOK1..DOK4
    reuseCount: integer("reuse_count").notNull().default(0),
    reuseSuccessCount: integer("reuse_success_count").notNull().default(0),
    reuseFailureCount: integer("reuse_failure_count").notNull().default(0),
    embedding: vector("embedding", { dimensions: 1536 }), // Phase 4: HNSW index deferred
    createdAt: createdAt(),
  },
  (t) => [
    index("learnings_project_created_idx").on(t.projectId, t.createdAt.desc()),
    index("learnings_bd_idx").on(t.bdId),
    index("learnings_applies_to_idx").using("gin", t.appliesTo), // tag search
    check("learnings_confidence_check", sql`${t.confidence} in ('low','medium','high')`),
    check(
      "learnings_dok_check",
      sql`${t.dokGrade} in ('ungraded','DOK1','DOK2','DOK3','DOK4')`,
    ),
  ],
);

/* ===================================================================== *
 * 6. Steering: briefs (identity-targeted), questions, feedback, choices
 * ===================================================================== */

export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown; becomes a STANDING INSTRUCTION
    targetKind: text("target_kind").notNull(), // org | team | project | agent
    targetId: text("target_id").notNull(), // 'org' | 'team.x' | 'project.x' | 'agent.x'
    authorId: text("author_id"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => briefs.id),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("briefs_target_idx").on(t.targetKind, t.targetId, t.effectiveFrom.desc()),
    check(
      "briefs_target_kind_check",
      sql`${t.targetKind} in ('org','team','project','agent')`,
    ),
  ],
);

export const briefAcks = pgTable(
  "brief_acks",
  {
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    ackedAt: timestamp("acked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.briefId, t.agentId] })],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    bdId: text("bd_id"),
    agentId: text("agent_id"),
    subject: text("subject"),
    body: text("body"),
    urgency: text("urgency"), // low | medium | high
    status: text("status").notNull().default("open"), // open | answered
    answer: text("answer"), // delivered back to the asker as a brief
    createdAt: createdAt(),
  },
  (t) => [
    check("questions_status_check", sql`${t.status} in ('open','answered')`),
    check(
      "questions_urgency_check",
      sql`${t.urgency} is null or ${t.urgency} in ('low','medium','high')`,
    ),
  ],
);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Agent-scoped, not project-scoped (can be about the platform itself) → no project_id,
  // no project RLS; handler-enforced.
  agentId: text("agent_id"),
  bdId: text("bd_id"),
  category: text("category"), // 'platform-bug' | 'wrong-brief' | ...
  body: text("body"),
  createdAt: createdAt(),
});

export const choices = pgTable(
  "choices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id"),
    bdId: text("bd_id"),
    // Denormalized for the uniform project_id RLS template (doc scopes via bd_id).
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    description: text("description"),
    outcome: text("outcome"), // filled once known (loop-close)
    status: text("status").notNull().default("open"), // open | resolved
    createdAt: createdAt(),
  },
  (t) => [check("choices_status_check", sql`${t.status} in ('open','resolved')`)],
);

/* ===================================================================== *
 * 7. Human identity: users + memberships (Phase 11, ADR-009)
 *
 * People (humans who supervise via the dashboard) are distinct from agents (AI principals
 * that read/write memory via tokens). Both are org-bounded. A user's role+scope come from
 * `memberships` ((user, scope_kind, scope_id) → role); a user can be e.g. manager of one team
 * and member of a project in another. users + memberships carry org_id and are org-RLS'd
 * (memos.org_id GUC) — the new DB-enforced isolation: org B can never read org A's people.
 * ===================================================================== */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // scrypt (low-entropy secret), NOT sha256
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"), // active | disabled
    // sha256 of the current dashboard-session bearer token (Phase 13). The token is a 256-bit
    // random secret (like agent tokens), so SHA-256 by-hash lookup is correct (not a password KDF).
    sessionTokenHash: text("session_token_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(sql`lower(${t.email})`), // case-insensitive unique login
    index("users_org_idx").on(t.orgId),
    index("users_session_token_idx").on(t.sessionTokenHash), // by-token auth lookup
    check("users_status_check", sql`${t.status} in ('active','disabled')`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    scopeKind: text("scope_kind").notNull(), // org | team | project
    scopeId: text("scope_id").notNull(), // 'org' | 'team.x' | 'project.x'
    role: text("role").notNull(), // ceo | manager | member (capability enforcement: Phase 12)
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_unique_idx").on(t.userId, t.scopeKind, t.scopeId),
    index("memberships_org_idx").on(t.orgId),
    check("memberships_scope_kind_check", sql`${t.scopeKind} in ('org','team','project')`),
    check("memberships_role_check", sql`${t.role} in ('ceo','manager','member')`),
  ],
);
