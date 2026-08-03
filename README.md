# SLE Audit v2.9

Статический frontend без npm для Vercel, FastAPI backend для Render и PostgreSQL Supabase.

## Изменения v2.9

- удалена функция отмены аудита; ранее отменённые аудиты скрыты из списков и отчётов;
- в визите оставлен только код ТТ и GPS;
- Dashboard показывает Базовый, Уверенный и Мастер;
- объединены блоки «Презентация + Работа с возражениями» и «Работа в точке + Обучение персонала»;
- последние завершённые аудиты: дата, коды ТТ, результат, зона роста и ссылки на локации;
- отчёты: «Отчет по аудиту» и «Детальный отчет» в Excel;
- исключено создание дубликатов сотрудников;
- сотрудник обязательно закрепляется за руководителем;
- менеджер при создании аудита выбирает руководителя;
- администратор и менеджер могут редактировать и удалять пользователей и сотрудников;
- переключатель RU/UZ удалён.

## Развертывание

### Render
Root Directory: `backend`

Build Command:
```bash
pip install --disable-pip-version-check --prefer-binary -r requirements.txt
```

Start Command:
```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log
```

При первом запуске после обновления backend автоматически добавит колонки `leader_id` в таблицы `employees` и `audits`.

### Vercel
Root Directory: `frontend`
Framework Preset: `Other`
Build/Install Command: пусто
Output Directory: `.`
