# Deploying TBVault to AWS EC2

One small server runs everything except the database and images:

```
browser ──HTTPS──> Nginx ──/api──> Node API (port 3000) ──> RDS PostgreSQL
                     │                  │   └──> S3 (product images, via IAM role)
                     │                  ├──> Redis (rate limits, idempotency)
                     └─ React build     └──> RabbitMQ ──> email worker ──> SMTP
```

RabbitMQ can run on the server (the default, `RABBITMQ_URL=amqp://127.0.0.1:5672`) or on a
hosted broker such as CloudAMQP's free plan (`RABBITMQ_URL=amqps://user:pass@host/vhost` in
`backend/.env.production`). With a hosted broker each deploy switches the local RabbitMQ off,
which frees about 100-150 MB of RAM. Create the CloudAMQP instance in AWS Sydney
(ap-southeast-2) so it sits next to this server.

All of this fits on a t3.micro (1 GB RAM) with the 2 GB swap the setup adds. Use t3.small
(2 GB) if the site gets real traffic.

## First time

From the repo root, in PowerShell, with the AWS CLI signed in as an admin:

1. `powershell -ExecutionPolicy Bypass -File backend\scripts\setup-rds.ps1` (if not done yet)
2. `powershell -ExecutionPolicy Bypass -File deploy\create-server.ps1`
   creates the server, SSH key (`~/.ssh/tbvault-key.pem`), firewall rules, S3 role and a fixed IP.
3. Point a domain at that IP, e.g. a free DuckDNS subdomain.
4. `powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Domain your.domain`
   writes `backend/.env.production` and stops. Check it (see what it prints), then
   run the same command again to deploy. The first deploy also installs Node, Nginx,
   Redis and, unless `RABBITMQ_URL` points to a hosted broker, RabbitMQ on the server.
5. Turn on HTTPS (login cookies need it), once the domain points at the server:
   `ssh -i ~/.ssh/tbvault-key.pem ubuntu@<ip> "sudo bash /srv/tbvault/enable-https.sh your.domain you@email.com"`

## Every release

Commit, then `powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1`.
Only committed code is deployed. If the new version doesn't start, the previous one is restored.

## On the server

| What | Command |
|---|---|
| API logs | `journalctl -u tbvault-api -f` |
| Email worker logs | `journalctl -u tbvault-worker -f` |
| Restart | `sudo systemctl restart tbvault-api tbvault-worker` |
| Status | `systemctl status tbvault-api tbvault-worker nginx redis-server` (add `rabbitmq-server` if it runs locally) |
| Memory | `free -h` |
| Server settings | `/srv/tbvault/shared/.env` (uploaded from `backend/.env.production` on each deploy) |
