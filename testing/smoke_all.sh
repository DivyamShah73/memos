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
# bash testing/phase1.sh   # auth + enroll        (added in Phase 1)
# bash testing/phase2.sh   # workflow + checkin   (added in Phase 2)
# bash testing/phase3.sh   # evidence gate        (added in Phase 3)
# bash testing/phase4.sh   # query                (added in Phase 4)
# bash testing/phase5.sh   # okrs                 (added in Phase 5)
# bash testing/phase6.sh   # briefs + critic      (added in Phase 6)
echo "=== ALL PHASES GREEN ==="
