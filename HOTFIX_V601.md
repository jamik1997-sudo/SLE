# SLE v6.0.1 Service Worker Hotfix

Исправлена ошибка:

`TypeError: Failed to execute 'clone' on 'Response': Response body is already used`

Причина: копирование Response выполнялось асинхронно после того, как браузер уже начал использовать тело ответа.

Исправление:
- `response.clone()` вызывается сразу;
- запись в Cache Storage передана в `event.waitUntil()`;
- добавлена безопасная обработка network-first и cache-first;
- версия PWA-кеша обновлена до `sle-audit-v6.0.1`.
