#!/usr/bin/env bash
# MemOS master regression suite. Grows one phase at a time; run top-to-bottom after
# every phase to catch regressions. A red earlier-phase check means something broke.
#
# Run from the repo root in Git Bash:  bash testing/smoke_all.sh
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

echo "=== MemOS smoke suite ==="
bash testing/phase0.sh   # repo + infra skeleton
bash testing/phase1.sh   # gateway core + auth + enroll
bash testing/phase2.sh   # workflow + checkin (provenance spine)
bash testing/phase3.sh   # artifacts + evidence-gated writes (THE core invariant)
bash testing/phase4.sh   # query (FTS over facts/learnings)
bash testing/phase5.sh   # okrs (goals + rollups)
# bash testing/phase6.sh   # briefs + critic      (added in Phase 6)
echo "=== ALL PHASES GREEN ==="
