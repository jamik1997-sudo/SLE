# SLE v6.1.1 — Cloudflare Worker

- Frontend API переведён с DuckDNS на `https://sle-api.jamik1997.workers.dev`.
- DuckDNS сохранён только как закрытый origin между Cloudflare Worker и Oracle VM.
- Обновлены `preconnect` и `dns-prefetch`.
- Версия frontend-ресурсов и PWA-кеша повышена до 6.1.1.
- Добавлен готовый исходный код Worker: `deploy/cloudflare-worker.js`.
- Логика фильтров, автоприменение и кнопка «Применить» сохранены.
