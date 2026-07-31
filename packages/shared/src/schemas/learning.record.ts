import { z } from "zod";

/** Tags are compared and stored normalized, so `" Project.Acme "` can't dodge the check below. */
export const normalizeAppliesTo = (tag: string): string => tag.trim().toLowerCase();

/**
 * `project.`/`team.`/`agent.` are MemOS id prefixes, never problem-domain terms — a tag like
 * `project.acme` re-silos the learning it's meant to make findable across projects (invariant 5).
 * Only these unambiguous id shapes are rejected here; judging whether a term is a *product* name
 * is the downstream tag-hygiene critic's job.
 */
export const isIdShapedTag = (tag: string): boolean =>
  /^(project|team|agent)\./.test(normalizeAppliesTo(tag));

const appliesToTagSchema = z
  .string()
  .min(1)
  .transform(normalizeAppliesTo)
  .refine((t) => t.length > 0, "must not be blank")
  .refine((t) => !isIdShapedTag(t), "must be a problem-domain term, not a project/team/agent id");

export const learningItemSchema = z.object({
  claim: z.string().min(1, "is required"),
  // problem-domain tags (NOT project names); the tag-hygiene critic checks quality later.
  applies_to: z.array(appliesToTagSchema).min(1, "at least one applies_to tag is required"),
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
    learnings: z
      .array(learningItemSchema)
      .min(1, "at least one learning is required")
      .max(100, "at most 100 learnings per batch"),
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
      // .trim() so a whitespace-only marker can't satisfy the non-obvious gate.
      if (!l.non_obvious_marker || l.non_obvious_marker.trim().length < 15) {
        ctx.addIssue({
          path: ["learnings", i, "non_obvious_marker"],
          code: "custom",
          message: "is required (>= 15 chars) when confidence >= medium",
        });
      }
    });
  });

export type LearningRecordInput = z.infer<typeof learningRecordInputSchema>;
