---
name: frontend-component
description: Build a polished MemOS dashboard component to the project design system (Next.js App Router, Tailwind, shadcn/ui, Framer Motion). Use for any new UI piece — OKR tree, activity feed, provenance graph, brief authoring, etc.
---

# MemOS Frontend Component

The dashboard is the showpiece — it must look extraordinary, not just functional. Every component is accessible, responsive, dark-mode-aware, and animated with restraint. Build to the design system; do not invent one-off styles.

## Design system (hold to this)
- **shadcn/ui** primitives (Button, Card, Dialog, Table, Badge, Tabs). Don't hand-roll what shadcn provides.
- **Tailwind** tokens only — no magic hex. Use the theme's semantic colors.
- **Framer Motion** for transitions: subtle, fast (150-250ms), purposeful. Animate entrance of new feed items, progress bar fills, graph node focus.
- **Dark mode** first, light mode parity.
- Empty states and loading skeletons are REQUIRED, not afterthoughts — they're what make it feel finished.
- Typography: one display face for headings, one mono for IDs/claims.

## Steps

### 1. Confirm the component's data contract
What does it render? Which intent(s) or API route feeds it? Define the TS type (import from `packages/shared` — never redefine).

### 2. Build the component — `packages/web/components/<area>/<Name>.tsx`
- Server component for data fetch where possible; client component only when it needs interactivity/realtime.
- Loading skeleton + empty state + error state, all designed.
- Accessible: keyboard nav, ARIA labels, focus rings.

### 3. Special-case the signature components (make these shine)
- **OKR tree:** nested cards with animated rollup progress bars (Recharts or a custom bar). Sub-OKR weight × milestone progress visibly rolls up to parent.
- **Live activity feed:** subscribe via Supabase Realtime / SSE; new items animate in at top; color-coded by type (checkin/fact/learning). This is the demo wow-moment — invest in it.
- **Provenance graph:** React Flow. Nodes = learning / artifact / workflow-run / OKR / agent; edges = the `bd_id` and `target_objective_id` links. Clicking a learning expands its full chain. This is the single most impressive screenshot — make it beautiful and interactive.
- **Trust leaderboard:** agents ranked by trust score with sparklines.

### 4. Wire realtime if applicable
Use Supabase Realtime channels or an SSE endpoint on the gateway. Debounce/batch updates so the feed doesn't thrash.

### 5. Polish pass
Hover states, transitions, responsive breakpoints (mobile → wide). Screenshot it in dark mode for the README.

## Done when
Component renders all states (loading/empty/error/data), matches the design system, animates with restraint, is accessible, and looks good enough to put in the README. Commit as `feat(web): <component>`.
