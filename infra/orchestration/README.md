# Orchestration

The repository ships a provider-neutral single-server Docker Compose baseline.
Use `compose.yaml` for local development and overlay
`compose.production.yaml` for a production control plane. The application
packages remain provider-neutral; the deployment layer supplies PostgreSQL,
Redis and Cloudflare R2 credentials through the environment.

```bash
Copy-Item .env.production.example .env.production
# Replace every `replace-*` value and URL-encode the database password.
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml config
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build
curl http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8787/ready
```

Put TLS and public access in a separate reverse proxy or managed edge
service. Do not expose PostgreSQL or Redis ports publicly. Back up the
PostgreSQL volume and verify restoration, and use a least-privilege R2 token.
This stack is a deployable control-plane baseline, not the managed LynxShip
cloud service or a native Android/iOS build worker fleet.
