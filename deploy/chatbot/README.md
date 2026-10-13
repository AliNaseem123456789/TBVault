# Deploying the chatbot to its own EC2 (separate AWS account)

The chatbot runs on its own server, in a second AWS account. The database (RDS) and the
product photos (S3) stay in the TBVault account; the scripts give the chatbot server access to both.

```
browser ──> TBVault site (account 1) ──/api/chat──HTTPS + X-Internal-Key──> chatbot server (account 2)
                 │                                                          │  ├──> RDS (account 1, port 5432)
                 └──> CloudAMQP <──── product changes ──── sync worker ─────┘  ├──> S3 photos (account 1, read-only)
                                                                                ├──> Pinecone, Groq
                                                                                └──> TBVault /api (order tools)
```

The server is a t3.small (2 GB RAM, on the free plan's credits). The models need about 1–1.3 GB.

## First time

From the repo root, in PowerShell:

1. Add the chatbot account to the AWS CLI (your existing login stays the default):
   `aws configure --profile chatbot`
   It asks for an access key of an admin user in the new account, region `ap-southeast-2`, output `json`.
2. `powershell -ExecutionPolicy Bypass -File deploy\chatbot\create-server.ps1`
   Creates the server, SSH key (`~/.ssh/tbvault-chatbot-key.pem`) and fixed IP in the chatbot account,
   and in the TBVault account lets that IP into the database and lets the server read product photos.
3. Point a domain at the printed IP, e.g. a second DuckDNS name like `tbvault-chat.duckdns.org`.
4. `powershell -ExecutionPolicy Bypass -File deploy\chatbot\deploy.ps1 -Domain tbvault-chat.duckdns.org`
   writes `chatbot/.env.production`, puts `CHATBOT_URL` + `CHATBOT_INTERNAL_KEY` into
   `backend/.env.production`, and stops. Check both, then run the same command again to deploy.
   The first deploy installs Python and Nginx and downloads the models (~700 MB).
5. Turn on HTTPS: `ssh -i ~/.ssh/tbvault-chatbot-key.pem ubuntu@<ip> "sudo bash /srv/chatbot/enable-https.sh tbvault-chat.duckdns.org you@email.com"`
6. Redeploy the shop so its backend talks to the new chatbot: `powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1`

## Every release

Commit, then `powershell -ExecutionPolicy Bypass -File deploy\chatbot\deploy.ps1`.
After `python -m app.cli reindex` on your PC, deploy again: it uploads the new BM25 statistics
(`chatbot/data/bm25_*.json`) that search needs to match the index.

## On the server

| What | Command |
|---|---|
| API logs | `journalctl -u chatbot-api -f` |
| Sync worker logs | `journalctl -u chatbot-sync -f` |
| Restart | `sudo systemctl restart chatbot-api chatbot-sync` |
| Connection check | `cd /srv/chatbot/current/chatbot && sudo -u chatbot /srv/chatbot/venv/bin/python -m app.cli check` |
| Chat stats | `cd /srv/chatbot/current/chatbot && sudo -u chatbot /srv/chatbot/venv/bin/python -m app.cli stats` |
| Memory | `free -h` |
| Settings | `/srv/chatbot/shared/.env` (uploaded from `chatbot/.env.production` on each deploy) |
