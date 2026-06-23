"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, GitBranch, Megaphone, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Console", icon: Target },
  { href: "/provenance", label: "Provenance", icon: GitBranch },
  { href: "/leaderboard", label: "Trust", icon: Trophy },
  { href: "/briefs", label: "Briefs", icon: Megaphone },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-1 text-sm">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition",
              active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            <Icon className={cn("h-4 w-4", active && "text-accent")} />
            {label}
          </Link>
        );
      })}
      <span className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted/60">
        <Activity className="h-4 w-4" /> Members
        <span className="ml-auto rounded bg-border px-1.5 py-0.5 text-[10px]">soon</span>
      </span>
    </nav>
  );
}
