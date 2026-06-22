// Governance workers' brains (Phase 6). Typed + tested here in @memos/api; the @memos/workers
// package provides thin runtime shims that import and run these. See ADR-006.
export { runEvidenceCritic, type CriticResult } from "./critic-evidence.js";
export { runBriefEscalation, type EscalationResult } from "./escalate.js";
