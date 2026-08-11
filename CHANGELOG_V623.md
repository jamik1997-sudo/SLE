# SLE v6.2.3 — Completed Visit Read-only View Fix

- Fixed backend startup: uses `user: User = Depends(current_user)`.
- Permanently keeps SQLAlchemy `and_` import.
- Rebuilt `/audits/{audit_id}/visit-view` using real model fields:
  `visit_number`, `question_key`, `answer_value`.
- Dashboard "Последние завершённые аудиты" opens the exact selected TT/visit, not the result screen.
- Read-only one-page questionnaire grouped by steps and sections.
- Shows 1/0/N/A, answer comments, goal, visit comment, evaluator, region, TT code, location and audit result.
- Leaders remain restricted to their own region.
