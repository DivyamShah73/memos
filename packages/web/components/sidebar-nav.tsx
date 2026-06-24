"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitBranch, Megaphone, Target, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Console", icon: Target },
  { href: "/provenance", label: "Provenance", icon: GitBranch },
  { href: "/leaderboard", label: "Trust", icon: Trophy },
  { href: "/briefs", label: "Briefs", icon: Megaphone },
];

export function SidebarNav({ role }: { role?: string }) {
  const pathname = usePathname();
  // Org administration is manager/CEO only (mirrors the API's ADMIN_INTENTS authz tier).
  const canAdmin = role === "manager" || role === "ceo";
  const items = canAdmin ? [...ITEMS, { href: "/admin", label: "Admin", icon: Users }] : ITEMS;
  return (
    <nav className="space-y-1 text-sm">
      {items.map(({ href, label, icon: Icon }) => {
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
    </nav>
  );
}
