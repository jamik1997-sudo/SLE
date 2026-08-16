# SLE v6.5.1 — Concurrent user performance

Target: stable simultaneous questionnaire work for a small team on the current Oracle VM.

Changes:
- Oracle systemd service now runs 2 Uvicorn workers.
- Uvicorn concurrency cap: 60 connections, keep-alive: 5 sec.
- PostgreSQL pool per worker: 4 persistent + 2 overflow connections.
- DB pool timeout reduced to 8 sec so saturation fails fast instead of appearing frozen.
- LIFO pool reuse and 10-minute recycle enabled.
- Nginx upstream keep-alive enabled (32 connections).
- Frontend answer autosave debounce increased to 1.1 sec.
- Existing single-drain autosave is preserved: one audit does not send parallel sync requests.
- GPS joins the normal autosave queue instead of starting a second synchronization path.
- Added 250 ms coalescing guard between immediate sync drains.
- API write timeout reduced to 12 sec.
- Added `deploy/apply-v650-oracle.sh` for Oracle service deployment.

Expected capacity is workload-dependent. This release is intended to remove the obvious
single-process / small-pool bottlenecks; actual capacity should be verified with real users.
