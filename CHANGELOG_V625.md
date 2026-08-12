# SLE v6.4.1 — Completed Visit Click Fix

- Fixed click on rows in “Последние завершённые аудиты”.
- Added a document-level delegated click fallback, so clicks survive dashboard re-render/autofilters.
- Direct row binding remains as a fast path.
- Coordinate links still open maps without opening the questionnaire.
- Backend keeps the corrected `current_user` dependency and permanent SQLAlchemy `and_` import.
- Read-only endpoint remains `/audits/{audit_id}/visit-view?visit_number=N`.
