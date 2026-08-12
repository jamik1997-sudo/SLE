# SLE v6.4.4 — Offline stability hotfix

- Fixed `restoreLocalAudit is not defined`.
- Normal online audit creation no longer depends on offline restore code.
- Added safe fallback for `persistDraft`.
- Hardened open-audit restore so an offline cache error cannot block online audits.
- Kept required comment logic for `analysis_2`.
- Permanent `OfflineTimingIn` backend model remains included.
- Dashboard content width increased up to 1600px.
- Employee names in “Последние завершённые аудиты” are shown on one line.
- All previous v6.4.3 fixes are preserved.

- Added missing `markVisitTiming()` and `syncStoredOfflineDrafts()` definitions after full offline helper audit.
