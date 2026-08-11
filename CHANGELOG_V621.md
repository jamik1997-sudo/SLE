# SLE v6.2.1 — Legacy Visit Goal Fix

- Added backward-compatible lookup for visit goal/comment in reports.
- Current visit fields are preferred.
- Known legacy aliases and JSON/draft containers are checked when current fields are empty.
- Old visits with no stored data display `—` instead of a blank cell.
- Added `backend/backfill_legacy_visit_goals.py` as a safe best-effort backfill utility.
- No historical value is invented: if it was never saved, it cannot be reconstructed.
