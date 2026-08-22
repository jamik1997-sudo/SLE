#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/SLE
git pull --ff-only
cd backend
source venv/bin/activate
pip install -r requirements.txt
python run_migrations.py
sudo systemctl restart sle
sleep 2
curl --fail --silent http://127.0.0.1:8000/ >/dev/null
sudo systemctl status sle --no-pager
