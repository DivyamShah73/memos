import { cn } from "@/lib/utils";

/** Shared fill color by progress/score, so OKR bars and trust bars never drift apart. */
export function barColor(value: number): string {
  if (value >= 0.8) return "bg-accent-2";
  if (value >= 0.4) return "bg-accent";
  return "bg-warn";
}

/** A track + fill bar for a 0..1 value. Callers add their own label/layout around it. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-border", className)}>
      <div
        className={cn("h-full rounded-full transition-all", barColor(clamped))}
        style={{ width: `${Math.round(clamped * 100)}%` }}
      />
    </div>
  );
}
