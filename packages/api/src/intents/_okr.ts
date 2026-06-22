/**
 * OKR rollup + progress math (Phase 5, ADR-005). The math functions (krProgress,
 * objectiveProgress, indexObjectives) are pure — Postgres `numeric` columns arrive as STRINGS
 * via postgres-js, so every metric/weight is Number()'d here, the single place that math
 * happens, so handlers and tests can't drift. `recomputeObjectiveProgress` is the one
 * DB-touching helper (the achieve / kr.update handlers both need the post-write rollup). NOT a
 * test (underscore prefix).
 *
 * Progress is always in [0,1]:
 *  - An explicitly achieved milestone/objective is 1 (achievement overrides any metric).
 *  - A key result (metric_target set): up → current/target, down → target/current, clamped.
 *  - A plain pending milestone (no metric) is 0.
 *  - An objective with sub-OKRs rolls up its children weighted by `weight` (abandoned/superseded
 *    children excluded); a leaf objective averages its milestones equally.
 */
import { eq } from "drizzle-orm";
import type { ScopedTx } from "../core/scope.js";
import { milestones, objectives } from "../db/schema.js";

export interface MilestoneRow {
  status: string; // 'pending' | 'achieved'
  metricTarget: string | number | null;
  metricCurrent: string | number | null;
  metricDirection: string | null; // 'up' | 'down' | null
}

export interface ObjectiveRow {
  id: string;
  parentId: string | null;
  status: string; // 'active' | 'achieved' | 'abandoned' | 'superseded'
  weight: string | number | null;
}

/** Group flat objective + milestone rows into the lookup maps the rollup recursion needs. */
export function indexObjectives(
  objs: ObjectiveRow[],
  milestoneRows: (MilestoneRow & { objectiveId: string })[],
): {
  childrenByParent: Map<string, ObjectiveRow[]>;
  milestonesByObjective: Map<string, MilestoneRow[]>;
} {
  const childrenByParent = new Map<string, ObjectiveRow[]>();
  for (const o of objs) {
    if (!o.parentId) continue;
    const arr = childrenByParent.get(o.parentId) ?? [];
    arr.push(o);
    childrenByParent.set(o.parentId, arr);
  }
  const milestonesByObjective = new Map<string, MilestoneRow[]>();
  for (const m of milestoneRows) {
    const arr = milestonesByObjective.get(m.objectiveId) ?? [];
    arr.push(m);
    milestonesByObjective.set(m.objectiveId, arr);
  }
  return { childrenByParent, milestonesByObjective };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Progress of a single milestone / key result, in [0,1]. */
export function krProgress(m: MilestoneRow): number {
  if (m.status === "achieved") return 1; // explicit achievement = 100%
  const t = num(m.metricTarget);
  if (t === null) return 0; // plain pending milestone, no metric
  const c = num(m.metricCurrent) ?? 0;
  if (m.metricDirection === "down") {
    if (c <= t) return 1; // at or below the target (lower is better)
    return c === 0 ? 0 : clamp01(t / c);
  }
  // up (default): higher is better
  if (t === 0) return c > 0 ? 1 : 0; // guard div-by-zero
  return clamp01(c / t);
}

const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const ACTIVE_FOR_ROLLUP = new Set(["active", "achieved"]);

/**
 * Rolled-up progress of an objective, in [0,1]. Children are looked up by parent id and their
 * milestones by objective id, so this recurses the whole subtree.
 */
export function objectiveProgress(
  node: ObjectiveRow,
  childrenByParent: Map<string, ObjectiveRow[]>,
  milestonesByObjective: Map<string, MilestoneRow[]>,
): number {
  if (node.status === "achieved") return 1;

  const kids = (childrenByParent.get(node.id) ?? []).filter((k) => ACTIVE_FOR_ROLLUP.has(k.status));
  if (kids.length > 0) {
    const weights = kids.map((k) => num(k.weight) ?? 1);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const childProgress = kids.map((k) =>
      objectiveProgress(k, childrenByParent, milestonesByObjective),
    );
    if (totalW === 0) return avg(childProgress); // all-zero weights → equal weight
    return clamp01(
      kids.reduce((sum, _k, i) => sum + weights[i] * childProgress[i], 0) / totalW,
    );
  }

  const ms = milestonesByObjective.get(node.id) ?? [];
  if (ms.length > 0) return avg(ms.map(krProgress));
  return 0; // leaf with no milestones and not achieved
}

/**
 * Re-read a project's objectives + milestones in-scope and return one objective's rolled-up
 * progress. Called inside the caller's withScope tx AFTER a write, so it reflects the change.
 * Returns null if the objective isn't visible in this project (shouldn't happen post-write).
 */
export async function recomputeObjectiveProgress(
  tx: ScopedTx,
  projectId: string,
  objectiveId: string,
): Promise<number | null> {
  const objs = await tx
    .select({
      id: objectives.id,
      parentId: objectives.parentId,
      status: objectives.status,
      weight: objectives.weight,
    })
    .from(objectives)
    .where(eq(objectives.projectId, projectId));
  const mss = await tx
    .select({
      objectiveId: milestones.objectiveId,
      status: milestones.status,
      metricTarget: milestones.metricTarget,
      metricCurrent: milestones.metricCurrent,
      metricDirection: milestones.metricDirection,
    })
    .from(milestones)
    .where(eq(milestones.projectId, projectId));

  const node = objs.find((o) => o.id === objectiveId);
  if (!node) return null;
  const { childrenByParent, milestonesByObjective } = indexObjectives(objs, mss);
  return objectiveProgress(node, childrenByParent, milestonesByObjective);
}
