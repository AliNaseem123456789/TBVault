#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for TBVault. Safe to re-run.
# Installs Node 22, Nginx, Redis, RabbitMQ and certbot, adds 2 GB swap,
# creates the tbvault user, systemd services and the Nginx site.
# Usually started by deploy.ps1; by hand: sudo bash setup-server.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "==> Swap (2 GB) so npm install and the services fit in 1 GB of RAM"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-tbvault.conf

echo "==> Packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg nginx redis-server rabbitmq-server certbot python3-certbot-nginx

if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

echo "==> Redis: capped at 100 MB (Ubuntu already binds it to localhost)"
grep -q '^maxmemory ' /etc/redis/redis.conf || printf '\nmaxmemory 100mb\nmaxmemory-policy allkeys-lru\n' >> /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl restart redis-server

echo "==> RabbitMQ: localhost only, small memory limit"
cat > /etc/rabbitmq/rabbitmq.conf <<'CONF'
listeners.tcp.default = 127.0.0.1:5672
vm_memory_high_watermark.relative = 0.3
CONF
systemctl enable --now rabbitmq-server
systemctl restart rabbitmq-server

echo "==> App user and folders"
id tbvault >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin tbvault
mkdir -p /srv/tbvault/releases /srv/tbvault/shared/certs
chown -R tbvault:tbvault /srv/tbvault

echo "==> systemd services"
cp "$HERE/tbvault-api.service" "$HERE/tbvault-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable tbvault-api tbvault-worker

echo "==> Nginx"
# Keep certbot's HTTPS block if it was already added to the live site file.
if [ ! -f /etc/nginx/sites-available/tbvault ] || ! grep -q 'managed by Certbot' /etc/nginx/sites-available/tbvault; then
  cp "$HERE/nginx.conf" /etc/nginx/sites-available/tbvault
fi
ln -sfn /etc/nginx/sites-available/tbvault /etc/nginx/sites-enabled/tbvault
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

touch /srv/tbvault/.setup-done
echo "==> Server setup done"
