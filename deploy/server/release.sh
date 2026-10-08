#!/usr/bin/env bash
# Installs one release uploaded by deploy.ps1 into /srv/tbvault and switches to it.
# Expects in its own folder: backend.tgz, frontend.tgz, env (backend .env), rds-global-bundle.pem
# If the new version doesn't answer its health check, the previous one is put back.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/srv/tbvault
KEEP=3

if [ ! -f "$APP/.setup-done" ] || [ "${FORCE_SETUP:-0}" = "1" ]; then
  bash "$HERE/setup-server.sh"
fi

release="$APP/releases/$(date +%Y%m%d-%H%M%S)"
echo "==> New release $release"
mkdir -p "$release/frontend"
# Any failure before the switch (npm, migrations...) removes the half-installed release.
trap 'rm -rf "$release"' ERR
tar -xzf "$HERE/backend.tgz" -C "$release"
tar -xzf "$HERE/frontend.tgz" -C "$release/frontend"

install -m 600 -o tbvault -g tbvault "$HERE/env" "$APP/shared/.env"
if [ -f "$HERE/rds-global-bundle.pem" ]; then
  install -m 644 -o tbvault -g tbvault "$HERE/rds-global-bundle.pem" "$APP/shared/certs/rds-global-bundle.pem"
fi
ln -sfn "$APP/shared/.env" "$release/backend/.env"
ln -sfn "$APP/shared/certs" "$release/backend/certs"
chown -R tbvault:tbvault "$release"

echo "==> npm ci, prisma generate, prisma migrate deploy"
cd "$release/backend"
sudo -u tbvault -H npm ci --no-audit --no-fund --loglevel=error
sudo -u tbvault -H npx prisma generate >/dev/null
sudo -u tbvault -H npx prisma migrate deploy

previous="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$release" "$APP/current"
systemctl restart tbvault-api tbvault-worker

echo "==> Health check"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/store/config >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo "!! API did not come up. Last log lines:"
  journalctl -u tbvault-api -n 40 --no-pager || true
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    echo "!! Rolling back to $previous"
    ln -sfn "$previous" "$APP/current"
    systemctl restart tbvault-api tbvault-worker
  fi
  rm -rf "$release"
  exit 1
fi
trap - ERR
systemctl reload nginx

echo "==> Removing old releases (keeping $KEEP)"
ls -1dt "$APP"/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf

install -m 755 "$HERE/enable-https.sh" "$APP/enable-https.sh"
rm -rf "$HERE"
echo "==> Live: $(basename "$release")"
