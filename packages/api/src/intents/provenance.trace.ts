/**
 * provenance.trace — the lineage graph of one learning, walking the bd_id spine (invariant #4):
 * learning → evidence artifact → workflow run → objective (OKR) → authoring agent. All reads are
 * in-scope (RLS) + explicit project_id filter, so you can only trace your own project's learnings;
 * the agent is read from the control-plane table. Returns nodes + edges for a graph view.
 */
import { and, eq } from "drizzle-orm";
import type { ProvenanceTraceInput } from "@memos/shared";
import type { IntentContext } from "../core/context.js";
import { ERROR_TYPE, fail, ok, type Envelope } from "../core/envelope.js";
import { agents, artifacts, learnings, objectives, workflowRuns } from "../db/schema.js";

interface Node {
  id: string;
  type: "learning" | "artifact" | "run" | "objective" | "agent";
  label: string;
}
interface Edge {
  from: string;
  to: string;
  label: string;
}

const trunc = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function provenanceTrace(
  ctx: IntentContext,
  input: ProvenanceTraceInput,
): Promise<Envelope> {
  const agent = ctx.agent;
  const withScope = ctx.withScope;
  if (!agent || !withScope) return fail("authentication required", ERROR_TYPE.unauthorized);

  const { project_id, learning_id } = input;
  if (!agent.scopes.includes(project_id)) {
    return fail(`project ${project_id} is not in scope`, ERROR_TYPE.forbidden);
  }

  const graph = await withScope(async (tx) => {
    const lrows = await tx
      .select({
        id: learnings.id,
        claim: learnings.claim,
        evidenceArtifactId: learnings.evidenceArtifactId,
        bdId: learnings.bdId,
        agentId: learnings.agentId,
      })
      .from(learnings)
      .where(and(eq(learnings.id, learning_id), eq(learnings.projectId, project_id)))
      .limit(1);
    if (lrows.length === 0) return null;
    const l = lrows[0];

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const learningNode = `learning:${l.id}`;
    nodes.push({ id: learningNode, type: "learning", label: trunc(l.claim) });

    if (l.evidenceArtifactId) {
      const a = await tx
        .select({ id: artifacts.id, kind: artifacts.kind })
        .from(artifacts)
        .where(and(eq(artifacts.id, l.evidenceArtifactId), eq(artifacts.projectId, project_id)))
        .limit(1);
      if (a.length > 0) {
        const n = `artifact:${a[0].id}`;
        nodes.push({ id: n, type: "artifact", label: a[0].kind ?? "artifact" });
        edges.push({ from: learningNode, to: n, label: "cites" });
      }
    }

    if (l.bdId) {
      const r = await tx
        .select({ bdId: workflowRuns.bdId, title: workflowRuns.title, targetObjectiveId: workflowRuns.targetObjectiveId })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.bdId, l.bdId), eq(workflowRuns.projectId, project_id)))
        .limit(1);
      if (r.length > 0) {
        const runNode = `run:${r[0].bdId}`;
        nodes.push({ id: runNode, type: "run", label: trunc(r[0].title ?? r[0].bdId, 32) });
        edges.push({ from: learningNode, to: runNode, label: "recorded in" });

        if (r[0].targetObjectiveId) {
          const o = await tx
            .select({ id: objectives.id, title: objectives.title })
            .from(objectives)
            .where(and(eq(objectives.id, r[0].targetObjectiveId), eq(objectives.projectId, project_id)))
            .limit(1);
          if (o.length > 0) {
            const objNode = `objective:${o[0].id}`;
            nodes.push({ id: objNode, type: "objective", label: trunc(o[0].title, 32) });
            edges.push({ from: runNode, to: objNode, label: "advances" });
          }
        }
      }
    }

    return { nodes, edges, agentId: l.agentId, learningNode };
  });

  if (graph === null) return fail("learning not found in this project", ERROR_TYPE.badRequest);

  // The authoring agent lives in the control-plane agents table (no RLS).
  if (graph.agentId) {
    const ag = await ctx.db
      .select({ id: agents.id, displayName: agents.displayName })
      .from(agents)
      .where(eq(agents.id, graph.agentId))
      .limit(1);
    if (ag.length > 0) {
      const agentNode = `agent:${ag[0].id}`;
      graph.nodes.push({ id: agentNode, type: "agent", label: ag[0].displayName });
      graph.edges.push({ from: graph.learningNode, to: agentNode, label: "authored by" });
    }
  }

  return ok({ nodes: graph.nodes, edges: graph.edges });
}
