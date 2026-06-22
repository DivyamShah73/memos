import { z } from "zod";

/**
 * Input for `milestone.achieve` — flip a milestone/KR to achieved and store an achievement
 * snapshot. Evidence-gated like fact/learning: confidence >= medium requires an
 * evidence_artifact_id (in the same project + run). bd_id is the run the achievement is made in.
 */
export const milestoneAchieveInputSchema = z
  .object({
    project_id: z.string().min(1, "is required"),
    bd_id: z.string().min(1, "is required"),
    milestone_id: z.string().uuid(),
    claim: z.string().min(1, "is required"),
    confidence: z.enum(["low", "medium", "high"]),
    evidence_artifact_id: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.confidence === "low") return;
    if (!v.evidence_artifact_id) {
      ctx.addIssue({
        path: ["evidence_artifact_id"],
        code: "custom",
        message: "is required when confidence >= medium",
      });
    }
  });

export type MilestoneAchieveInput = z.infer<typeof milestoneAchieveInputSchema>;
