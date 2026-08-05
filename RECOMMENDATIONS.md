# Рекомендации для SLE на Oracle Cloud 1 OCPU / 1 GB RAM

## Уже применено в версии 3.5.4

- Backend переведён на `https://sle-audit.duckdns.org`.
- Удалено ожидание пробуждения Render и лишний keep-alive.
- Повторные GET-запросы сокращены с 4 до 2, задержка повторения уменьшена.
- Все JS/CSS файлы PWA предварительно кешируются.
- Для версионных JS/CSS включён длительный immutable-кеш Vercel.
- `index.html`, `config.js` и Service Worker всегда проверяют свежую версию.
- Пул PostgreSQL уменьшен до 3 основных + 2 дополнительных соединений для стабильности на 1 GB RAM.
- Добавлены готовые `systemd`, Nginx и скрипт обновления через GitHub.

## Рекомендуемый режим эксплуатации

1. Использовать только 1 Uvicorn worker.
2. Оставить swap 2 GB.
3. Не запускать Docker, PostgreSQL и другие тяжёлые службы на этой VM.
4. Supabase оставить отдельной базой данных.
5. Обновлять backend командой `~/update.sh`.
6. Раз в неделю проверять `free -h`, `df -h` и логи `journalctl -u sle`.
7. Render не удалять 2–3 дня после полного теста, затем остановить.
8. Перед крупными изменениями создавать Git tag или отдельную ветку.

## Проверка скорости

- API health: `curl -w '%{time_total}\n' -o /dev/null -s https://sle-audit.duckdns.org/health`
- Память: `free -h`
- Нагрузка: `top`
- Последние ошибки: `sudo journalctl -u sle -n 100 --no-pager`
