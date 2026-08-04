#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

python run_migrations.py
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --no-access-log
