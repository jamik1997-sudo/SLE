#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/SLE

echo "[1/6] Получение обновлений"
git pull --ff-only

echo "[2/6] Активация окружения"
source backend/venv/bin/activate

echo "[3/6] Установка зависимостей"
pip install --disable-pip-version-check -q -r backend/requirements.txt

echo "[4/6] Миграции"
cd backend
python run_migrations.py

echo "[5/6] Перезапуск"
sudo systemctl restart sle

echo "[6/6] Проверка"
sleep 2
curl --fail --silent http://127.0.0.1:8000/health >/dev/null
sudo systemctl --no-pager --full status sle | head -20
echo "SLE успешно обновлён"
