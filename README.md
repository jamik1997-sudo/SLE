# SLE Audit v3.0

Чистая модульная архитектура без npm и Node.js.

## Структура

- `frontend/js/core/runtime.js` — состояние, API, кэш, тема, PWA и общие утилиты.
- `frontend/js/pages/auth.js` — авторизация и запуск приложения.
- `frontend/js/pages/home.js` — главная, навигация, поиск, карточки сотрудников, журнал и настройки.
- `frontend/js/pages/reports.js` — история, Dashboard, фильтры и отчёты.
- `frontend/js/pages/audit.js` — мастер опроса, GPS, QR, автосохранение и завершение.
- `frontend/js/pages/admin.js` — регионы, сотрудники, руководители, пользователи, пароль и Excel.
- `backend/app/routers/` — отдельные API-модули авторизации, аудитов, администрирования и отчётов.

## Vercel

- Root Directory: `frontend`
- Framework: `Other`
- Build Command: пусто
- Install Command: пусто
- Output Directory: `.`

## Render

- Root Directory: `backend`
- Build: `pip install --disable-pip-version-check --prefer-binary -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log`

Переменные окружения сохраняются прежними. Для существующей базы `INIT_DB_ON_START=false`.
