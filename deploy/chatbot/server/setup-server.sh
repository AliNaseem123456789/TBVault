#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for the chatbot. Safe to re-run.
# Installs Python + venv, Nginx and certbot, adds 2 GB swap, creates the chatbot user,
# the shared Python environment, systemd services and the Nginx site.
# Usually started by deploy\chatbot\deploy.ps1; by hand: sudo bash setup-server.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/srv/chatbot
export DEBIAN_FRONTEND=noninteractive

echo "==> Swap (2 GB): model downloads and pip installs need headroom on a 2 GB server"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-chatbot.conf

echo "==> Packages"
apt-get update -q
apt-get install -y -q ca-certificates curl python3 python3-venv python3-pip nginx certbot python3-certbot-nginx

echo "==> App user and folders"
id chatbot >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin chatbot
mkdir -p "$APP/releases" "$APP/shared/certs" "$APP/shared/data"
chown -R chatbot:chatbot "$APP"

echo "==> Python environment (shared by all releases; release.sh installs the packages)"
if [ ! -x "$APP/venv/bin/python" ]; then
  sudo -u chatbot python3 -m venv "$APP/venv"
  sudo -u chatbot "$APP/venv/bin/pip" install -q --upgrade pip
fi

echo "==> systemd services"
cp "$HERE/chatbot-api.service" "$HERE/chatbot-sync.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable chatbot-api

echo "==> Nginx"
# Keep certbot's HTTPS block if it was already added to the live site file.
if [ ! -f /etc/nginx/sites-available/chatbot ] || ! grep -q 'managed by Certbot' /etc/nginx/sites-available/chatbot; then
  cp "$HERE/nginx.conf" /etc/nginx/sites-available/chatbot
fi
ln -sfn /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/chatbot
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

touch "$APP/.setup-done"
echo "==> Server setup done"
