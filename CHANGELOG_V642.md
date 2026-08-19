# SLE v6.5.5

- Permanent backend fix: `OfflineTimingIn(BaseModel)` is defined in `extras.py`.
- “Последние завершённые аудиты” table layout improved.
- `Точка 1/2/3/4/5`, date, time, TT code and result no longer wrap to multiple lines.
- Question `analysis_2` (“Определяет, что помогло и что помешало достижению целей — навыки”) now requires a comment.
- The required comment is enforced in the UI and again by backend on submit.
- Offline draft persistence keeps the comment and syncs it with the answer.
