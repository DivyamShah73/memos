import { callIntent, getProjectId } from "@/lib/memos";
import type { LearningListItem, ProvEdge, ProvNode } from "@/lib/types";
import { ProvenanceExplorer } from "@/components/provenance-explorer";

export const dynamic = "force-dynamic";

export default async function ProvenancePage({
  searchParams,
}: {
  searchParams: Promise<{ learning?: string }>;
}) {
  const PROJECT = await getProjectId();
  const { learning } = await searchParams;
  const list = await callIntent<{ learnings: LearningListItem[] }>("learning.list", {
    project_id: PROJECT,
  }).catch(() => ({ learnings: [] as LearningListItem[] }));

  // Prefetch every lineage once, in parallel — so client-side selection is instant rather than a
  // server round-trip (+ full list refetch) per click across the Vercel → Render → Neon hop.
  const entries = await Promise.all(
    list.learnings.map(async (l) => {
      const g = await callIntent<{ nodes: ProvNode[]; edges: ProvEdge[] }>("provenance.trace", {
        project_id: PROJECT,
        learning_id: l.id,
      }).catch(() => ({ nodes: [] as ProvNode[], edges: [] as ProvEdge[] }));
      return [l.id, g] as const;
    }),
  );
  const lineages = Object.fromEntries(entries);

  return (
    <ProvenanceExplorer
      learnings={list.learnings}
      lineages={lineages}
      initialId={learning ?? list.learnings[0]?.id}
    />
  );
}
