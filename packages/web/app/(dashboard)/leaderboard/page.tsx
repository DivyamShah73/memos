import { callIntent } from "@/lib/memos";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/lib/types";

export const dynamic = "force-dynamic";
const PROJECT = process.env.MEMOS_PROJECT_ID ?? "project.demo";

function trustColor(t: number): string {
  if (t >= 0.8) return "bg-accent-2";
  if (t >= 0.5) return "bg-accent";
  return "bg-warn";
}

export default async function LeaderboardPage() {
  const { leaderboard } = await callIntent<{ leaderboard: LeaderboardRow[] }>("trust.leaderboard", {
    project_id: PROJECT,
  }).catch(() => ({ leaderboard: [] as LeaderboardRow[] }));

  return (
    <div className="max-w-2xl">
      <h2 className="mb-3 text-sm font-medium text-muted">Agent trust leaderboard</h2>
      <div className="overflow-hidden rounded-xl border border-border bg-surface/70">
        <ul className="divide-y divide-border/60">
          {leaderboard.map((a, i) => (
            <li key={a.agent_id} className="flex items-center gap-4 px-4 py-3">
              <span className="w-6 text-center font-mono text-sm text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{a.display_name}</span>
                  <span className="truncate font-mono text-[11px] text-muted">{a.agent_id}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn("h-full rounded-full", trustColor(a.trust_score))}
                      style={{ width: `${Math.round(a.trust_score * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-muted">{a.trust_score.toFixed(2)}</span>
                </div>
              </div>
              <span className="shrink-0 text-right text-xs text-muted">
                <span className="font-mono text-fg/80">{a.learnings_authored}</span> learnings
              </span>
            </li>
          ))}
          {leaderboard.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted">No agents yet.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
