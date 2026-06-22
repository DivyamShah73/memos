/**
 * Runner: 24h brief-escalation sweep. Invoked via `pnpm --filter @memos/workers run briefs:escalate`.
 * The logic lives in @memos/api/governance (typed + tested there); this is just the entrypoint.
 */
import { runBriefEscalation } from "@memos/api/governance";

const result = await runBriefEscalation();
console.log(`[briefs:escalate] escalated=${result.escalated}`);
process.exit(0);
