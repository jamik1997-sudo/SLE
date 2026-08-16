#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/SLE/backend
source venv/bin/activate
python run_migrations.py

sudo cp /home/ubuntu/SLE/deploy/sle.service /etc/systemd/system/sle.service
sudo systemctl daemon-reload
sudo systemctl restart sle

sleep 5
sudo systemctl status sle --no-pager -l
curl -s -o /dev/null -w "LOCAL: %{http_code} %{time_total}s\n" http://127.0.0.1:8000/
