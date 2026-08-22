#!/bin/bash
set -euo pipefail

REPO="/home/ubuntu/SLE"

if [ ! -x /usr/local/bin/sle-update ]; then
  echo "Ошибка: сначала установите /usr/local/bin/sle-update"
  exit 1
fi

install -o root -g root -m 0644 "$REPO/deploy/sle-update.service" /etc/systemd/system/sle-update.service
install -o root -g root -m 0440 "$REPO/deploy/sle-update-sudoers" /etc/sudoers.d/sle-update
visudo -cf /etc/sudoers.d/sle-update
systemctl daemon-reload

echo "Веб-обновление SLE установлено"
systemctl status sle-update.service --no-pager || true

