# SLE v6.1.9 — Edge white-screen hotfix

- Исправлен белый экран `state.audits.filter is not a function`.
- Ответы списковых API нормализуются в массивы (`items`, `rows`, `data`, `audits`).
- Повреждённый/старый localStorage cache больше не ломает главное меню.
- Добавлен безопасный экран ошибки вместо пустой страницы при ошибке renderHome.
- Аналогичная защита добавлена для отчетов, журнала и списка настроек вопросов.
- PWA/cache-busting обновлены до v6.1.9.
