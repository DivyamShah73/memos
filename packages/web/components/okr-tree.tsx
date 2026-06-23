import { cn } from "@/lib/utils";
import type { Milestone, ObjectiveNode } from "@/lib/types";
import { ProgressBar } from "@/components/progress-bar";

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Bar + right-aligned percentage label (the OKR/milestone variant). */
function LabeledBar({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress)); // keep the label and the bar in agreement
  return (
    <div className="flex items-center gap-3">
      <ProgressBar value={clamped} className="flex-1" />
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
        {pct(clamped)}
      </span>
    </div>
  );
}

function statusChip(status: string): string {
  switch (status) {
    case "achieved":
      return "bg-accent-2/15 text-accent-2";
    case "abandoned":
    case "superseded":
      return "bg-danger/15 text-danger";
    default:
      return "bg-border text-muted";
  }
}

function MilestoneRow({ m }: { m: Milestone }) {
  const metric =
    m.metric_target != null
      ? `${m.metric_current ?? 0} / ${m.metric_target}${m.metric_direction === "down" ? " ↓" : ""}`
      : null;
  return (
    <div className="flex items-center gap-3 py-1.5 pl-4 text-sm">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          m.status === "achieved" ? "bg-accent-2" : "bg-muted/50",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-fg/90">{m.title}</span>
      {metric ? <span className="font-mono text-xs text-muted">{metric}</span> : null}
      <span className="w-24">
        <LabeledBar progress={m.progress} />
      </span>
    </div>
  );
}

function ObjectiveCard({ node, depth = 0 }: { node: ObjectiveNode; depth?: number }) {
  return (
    <div className={cn(depth > 0 && "border-l border-border pl-4")}>
      <div className="rounded-xl border border-border bg-surface/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium tracking-tight text-fg">{node.title}</h3>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", statusChip(node.status))}>
                {node.status}
              </span>
              {node.weight != null ? (
                <span className="rounded bg-border px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  w{node.weight}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <LabeledBar progress={node.progress} />
        </div>
        {node.milestones.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-2">
            {node.milestones.map((m) => (
              <MilestoneRow key={m.id} m={m} />
            ))}
          </div>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <div className="mt-3 space-y-3 pl-4">
          {node.children.map((c) => (
            <ObjectiveCard key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OkrTree({ objectives }: { objectives: ObjectiveNode[] }) {
  if (objectives.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
        No objectives yet. Run <code className="font-mono">pnpm db:seed</code>.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {objectives.map((o) => (
        <ObjectiveCard key={o.id} node={o} />
      ))}
    </div>
  );
}
