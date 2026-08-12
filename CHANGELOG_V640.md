# SLE v6.4.3 — Offline Mode

- Audit questionnaire continues working without internet after required lists/questionnaire were cached once.
- A new audit can be created offline from cached region/employee data.
- Answers, visit fields, GPS, navigation step and local visit timing are persisted in IndexedDB with localStorage fallback.
- On reconnect the app creates/remaps a local audit if needed, uploads the complete snapshot, restores visit timings, and submits an audit marked “Ожидает отправки”.
- Unfinished local audits from a previous Tashkent date are discarded and cannot be continued next day.
- Offline/Sync status banner is shown.
- TT code input accepts only A-Z and 0-9; lowercase letters are converted to uppercase automatically.
- Existing v6.3.0 comparison module and Cloudflare Worker → DuckDNS → Oracle routing are preserved.
