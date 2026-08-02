# SLE Audit System

Веб-система оценки SLE по 5 торговым точкам.

## Стек
- Frontend: Next.js 15 / TypeScript — Vercel
- Backend: FastAPI / SQLAlchemy — Render
- Database: PostgreSQL — Supabase

## Возможности MVP
- Авторизация по логину и паролю.
- Роли: Администратор, Руководитель, Менеджер.
- Создание пользователей администратором и менеджером.
- Привязка пользователей и сотрудников к регионам.
- Для руководителя регион подставляется автоматически; выбирается только сотрудник.
- 5 торговых точек × 7 шагов + подготовка к рабочему дню + завершение дня.
- GPS для каждой торговой точки.
- Автосохранение каждого ответа и каждого шага.
- Продолжение незавершённого аудита.
- Обязательный комментарий при ответах `0` и `N/A`.
- Расчёт результата по весам SLE и исключение `N/A` из знаменателя.
- Уровни: Базовый, Уверенный, Мастер.

## Быстрый запуск локально

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Откройте `http://localhost:3000`.

## Supabase
1. Создайте проект Supabase.
2. Откройте SQL Editor.
3. Выполните `supabase/schema.sql`.
4. В Render укажите `DATABASE_URL` из Supabase (`Session pooler`, порт 5432 или Transaction pooler, порт 6543).
5. Если в пароле есть спецсимволы, URL-кодируйте их.

## Render
Создайте Web Service из папки `backend`:
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`

Переменные:
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS=https://ВАШ-САЙТ.vercel.app`
- `SEED_ADMIN_LOGIN=admin`
- `SEED_ADMIN_PASSWORD=ChangeMe123!`

После первого запуска смените пароль администратора.

## Vercel
Импортируйте репозиторий и выберите Root Directory `frontend`.

Переменная:
- `NEXT_PUBLIC_API_URL=https://ВАШ-BACKEND.onrender.com`

## Тестовая учётная запись
При первом запуске backend автоматически создаётся администратор из переменных `SEED_ADMIN_LOGIN` и `SEED_ADMIN_PASSWORD`.

## Progressive Web App (PWA)
Frontend поддерживает установку как приложение на Android, iOS и компьютере.

Включено:
- web app manifest;
- Service Worker;
- иконки 192×192 и 512×512;
- maskable-иконка для Android;
- standalone-режим без панели браузера;
- базовый офлайн-экран;
- кэширование оболочки приложения и ранее открытых страниц;
- API и персональные ответы не сохраняются в общем кэше Service Worker.

После публикации на Vercel откройте сайт по HTTPS:
- Android/Chrome: меню браузера → «Установить приложение»;
- iPhone/Safari: «Поделиться» → «На экран Домой»;
- компьютер/Chrome или Edge: значок установки в адресной строке.

При изменении списка кэшируемых ресурсов обновите `CACHE_NAME` в `frontend/public/sw.js`, например с `sle-audit-v1` на `sle-audit-v2`.
