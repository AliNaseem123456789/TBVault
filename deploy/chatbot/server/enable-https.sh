#!/usr/bin/env bash
# Gets a free Let's Encrypt certificate for the chatbot's domain and switches Nginx to HTTPS.
# The domain must already point at this server's IP.
#   sudo bash /srv/chatbot/enable-https.sh tbvault-chat.duckdns.org you@example.com
set -euo pipefail
DOMAIN="${1:?usage: enable-https.sh <domain> <email>}"
EMAIL="${2:?usage: enable-https.sh <domain> <email>}"
sed -i "s/server_name .*;/server_name $DOMAIN;/" /etc/nginx/sites-available/chatbot
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "$EMAIL"
echo "HTTPS is on: https://$DOMAIN (renews automatically)"
