import { z } from "zod";

export const learningItemSchema = z.object({
  claim: z.string().min(1, "is required"),
  // problem-domain tags (NOT project names); the tag-hygiene critic checks quality later.
  applies_to: z.array(z.string().min(1)).min(1, "at least one applies_to tag is required"),
  confidence: z.enum(["low", "medium", "high"]),
  non_obvious_marker: z.string().optional(),
  evidence_artifact_id: z.string().uuid().optional(),
});

/**
 * Input for `learning.record` (batched). Two gates per item at confidence >= medium: the
 * evidence gate (evidence_artifact_id required) AND the non-obvious gate (non_obvious_marker
 * present, >= 15 chars). The handler re-checks evidence + that the artifact is same project/run.
 */
export const learningRecordInputSchema = z
  .object({
    project_id: z.string().min(1, "is required"),
    bd_id: z.string().min(1, "is required"),
    learnings: z.array(learningItemSchema).min(1, "at least one learning is required"),
  })
  .superRefine((v, ctx) => {
    v.learnings.forEach((l, i) => {
      if (l.confidence === "low") return;
      if (!l.evidence_artifact_id) {
        ctx.addIssue({
          path: ["learnings", i, "evidence_artifact_id"],
          code: "custom",
          message: "is required when confidence >= medium",
        });
      }
      if (!l.non_obvious_marker || l.non_obvious_marker.length < 15) {
        ctx.addIssue({
          path: ["learnings", i, "non_obvious_marker"],
          code: "custom",
          message: "is required (>= 15 chars) when confidence >= medium",
        });
      }
    });
  });

export type LearningRecordInput = z.infer<typeof learningRecordInputSchema>;
