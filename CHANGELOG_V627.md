# SLE v6.4.4 — Worker DuckDNS Origin

- Frontend still uses only `https://sle-api.jamik1997.workers.dev`.
- Cloudflare Worker origin restored to `https://sle-audit.duckdns.org`.
- DuckDNS is not exposed directly to the browser/frontend.
- OPTIONS/CORS handling includes `X-Device-ID`.
- Worker strips Cloudflare-specific request headers before proxying.
- Worker returns a controlled 502 JSON response if Oracle/DuckDNS is temporarily unavailable.
- Existing v6.2.5/v6.2.6 dashboard and backend fixes are preserved.
