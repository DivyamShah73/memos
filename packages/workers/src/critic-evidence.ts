/**
 * Runner: evidence-compliance critic. Invoked via `pnpm --filter @memos/workers run critic:evidence`.
 * The logic lives in @memos/api/governance (typed + tested there); this is just the entrypoint.
 */
import { runEvidenceCritic } from "@memos/api/governance";

const result = await runEvidenceCritic();
console.log(`[critic:evidence] scanned=${result.scanned} filed=${result.filed}`);
process.exit(0);
