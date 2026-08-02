# SLE Audit — версия без npm

Проект состоит из:

- `frontend/` — обычные HTML, CSS и JavaScript. Node.js и npm не нужны.
- `backend/` — FastAPI для Render.
- Supabase PostgreSQL используется через `DATABASE_URL` backend.

## Настройка frontend

Откройте `frontend/config.js` и укажите адрес Render:

```js
window.SLE_CONFIG = {
  API_URL: "https://sle-x1o0.onrender.com"
};
```

## Развёртывание frontend на Vercel

1. Загрузите проект в GitHub.
2. В Vercel импортируйте репозиторий.
3. Root Directory: `frontend`.
4. Framework Preset: `Other`.
5. Build Command: оставить пустым.
6. Output Directory: `.`
7. Install Command: оставить пустым.
8. Нажать Deploy.

В проекте нет `package.json`, поэтому Vercel ничего не устанавливает через npm.

## Render

Root Directory: `backend`

Build Command:

```bash
pip install -r requirements.txt
```

Start Command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

После получения адреса Vercel добавьте его в `CORS_ORIGINS` на Render.

## PWA

PWA включено через `manifest.webmanifest` и `sw.js`. На Android приложение можно установить через меню Chrome, на iPhone — через Safari → Поделиться → На экран «Домой».


## Оптимизация v2
- Пакетное сохранение ответов одним запросом `/audits/{id}/sync`.
- Debounce 700 мс и мгновенное локальное сохранение.
- Кэширование опросника, регионов и сотрудников.
- Облегчённые запросы backend при сохранении.
- Пул соединений PostgreSQL, GZip и лимит истории.
- Обновлённый service worker и CDN-кэш статических файлов.


## Изменения v4
- Удалён вариант ответа N/A во всех вопросах.
- Для ответа 0 комментарий больше не требуется.
- CORS разрешает основной домен Vercel и preview-домены `*.vercel.app`.
- После обновления очистите PWA-кэш или переустановите приложение.
