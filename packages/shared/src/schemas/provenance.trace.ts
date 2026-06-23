import { z } from "zod";

/**
 * Input for `provenance.trace` — return the lineage graph of a learning: the learning, its
 * evidence artifact, the workflow run it was recorded in, the objective that run advanced, and
 * the authoring agent. Nodes + edges, ready for a graph view.
 */
export const provenanceTraceInputSchema = z.object({
  project_id: z.string().min(1, "is required"),
  learning_id: z.string().uuid(),
});

export type ProvenanceTraceInput = z.infer<typeof provenanceTraceInputSchema>;
