import { callIntent } from "@/lib/memos";
import type { ActivityItem, ObjectiveNode } from "@/lib/types";
import { OkrTree } from "@/components/okr-tree";
import { ActivityFeed } from "@/components/activity-feed";

export const dynamic = "force-dynamic";

const PROJECT = process.env.MEMOS_PROJECT_ID ?? "project.demo";

export default async function DashboardPage() {
  const [okr, act] = await Promise.all([
    callIntent<{ objectives: ObjectiveNode[] }>("objective.query", { project_id: PROJECT }),
    callIntent<{ activity: ActivityItem[] }>("activity.recent", { project_id: PROJECT, limit: 30 }),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <section className="lg:col-span-2">
        <h2 className="mb-3 text-sm font-medium text-muted">Objectives &amp; Key Results</h2>
        <OkrTree objectives={okr.objectives} />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Live activity</h2>
        <ActivityFeed projectId={PROJECT} initial={act.activity} />
      </section>
    </div>
  );
}
