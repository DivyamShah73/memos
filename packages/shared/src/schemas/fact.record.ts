import { z } from "zod";

export const factItemSchema = z.object({
  claim: z.string().min(1, "is required"),
  confidence: z.enum(["low", "medium", "high"]),
  evidence_artifact_id: z.string().uuid().optional(),
});

/**
 * Input for `fact.record` (batched). The evidence gate is enforced here per item: a fact at
 * confidence >= medium MUST cite an evidence_artifact_id. The handler re-checks this AND that
 * the cited artifact exists in the same project/run (defense in depth).
 */
export const factRecordInputSchema = z
  .object({
    project_id: z.string().min(1, "is required"),
    bd_id: z.string().min(1, "is required"),
    facts: z.array(factItemSchema).min(1, "at least one fact is required"),
  })
  .superRefine((v, ctx) => {
    v.facts.forEach((f, i) => {
      if (f.confidence !== "low" && !f.evidence_artifact_id) {
        ctx.addIssue({
          path: ["facts", i, "evidence_artifact_id"],
          code: "custom",
          message: "is required when confidence >= medium",
        });
      }
    });
  });

export type FactRecordInput = z.infer<typeof factRecordInputSchema>;
