#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

python run_migrations.py
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --workers "${WEB_CONCURRENCY:-2}" --limit-concurrency "${UVICORN_LIMIT_CONCURRENCY:-60}" --timeout-keep-alive 5 --no-access-log
