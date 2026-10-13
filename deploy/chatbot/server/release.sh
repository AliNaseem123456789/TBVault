#!/usr/bin/env bash
# Installs one chatbot release uploaded by deploy\chatbot\deploy.ps1 into /srv/chatbot and switches to it.
# Expects in its own folder: chatbot.tgz, env, and optionally rds-global-bundle.pem, bm25_params.json,
# bm25_policies.json. If the new version doesn't answer its health check, the previous one is put back.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/srv/chatbot
PY="$APP/venv/bin/python"
KEEP=3
as_chatbot() { sudo -u chatbot -H "$@"; }

if [ ! -f "$APP/.setup-done" ] || [ "${FORCE_SETUP:-0}" = "1" ]; then
  bash "$HERE/setup-server.sh"
fi

release="$APP/releases/$(date +%Y%m%d-%H%M%S)"
echo "==> New release $release"
mkdir -p "$release"
# Any failure before the switch (pip...) removes the half-installed release.
trap 'rm -rf "$release"' ERR
tar -xzf "$HERE/chatbot.tgz" -C "$release"
code="$release/chatbot"

# Settings and data live in shared/ and survive releases: .env, the RDS certificate,
# downloaded models, BM25 statistics and the request logs.
install -m 600 -o chatbot -g chatbot "$HERE/env" "$APP/shared/.env"
if [ -f "$HERE/rds-global-bundle.pem" ]; then
  install -m 644 -o chatbot -g chatbot "$HERE/rds-global-bundle.pem" "$APP/shared/certs/rds-global-bundle.pem"
fi
for f in bm25_params.json bm25_policies.json; do
  if [ -f "$HERE/$f" ]; then install -m 644 -o chatbot -g chatbot "$HERE/$f" "$APP/shared/data/$f"; fi
done
ln -sfn "$APP/shared/.env" "$code/.env"
rm -rf "$code/data"
ln -sfn "$APP/shared/data" "$code/data"
chown -R chatbot:chatbot "$release" "$APP/shared"

echo "==> Python packages"
as_chatbot "$APP/venv/bin/pip" install -q --disable-pip-version-check -r "$code/requirements.txt"

echo "==> Checking connections and downloading models (first time ~700 MB, a few minutes)"
(cd "$code" && as_chatbot "$PY" -m app.cli check) || true

if [ ! -f "$APP/shared/data/bm25_params.json" ]; then
  echo "==> No BM25 statistics uploaded: rebuilding the search index here (products, photos, policies)"
  (cd "$code" && as_chatbot "$PY" -m app.cli reindex)
fi

echo "==> systemd services"
cp "$HERE/chatbot-api.service" "$HERE/chatbot-sync.service" /etc/systemd/system/
systemctl daemon-reload

# The sync worker keeps Pinecone in step with product changes through RabbitMQ. It only makes
# sense with a broker this server can reach (CloudAMQP); a local URL points at nothing here.
# The URL holds a password: never print it.
rabbit_url="$(grep -E '^RABBITMQ_URL=' "$APP/shared/.env" | head -1 | cut -d= -f2- || true)"
case "$rabbit_url" in
  *127.0.0.1*|*localhost*|"")
    echo "==> Sync worker: off (RABBITMQ_URL is not a hosted broker)"
    systemctl disable --now chatbot-sync 2>/dev/null || true
    sync_on=0 ;;
  *)
    echo "==> Sync worker: on (hosted broker)"
    systemctl enable chatbot-sync >/dev/null 2>&1
    sync_on=1 ;;
esac

previous="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$release" "$APP/current"
restart() {
  systemctl restart chatbot-api
  if [ "$sync_on" = "1" ]; then systemctl restart chatbot-sync; fi
}
restart

echo "==> Health check"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo "!! Chatbot did not come up. Last log lines:"
  journalctl -u chatbot-api -n 40 --no-pager || true
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    echo "!! Rolling back to $previous"
    ln -sfn "$previous" "$APP/current"
    restart
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
