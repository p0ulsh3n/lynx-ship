# Container policy

Images remain non-root, use runtime-only secrets, expose health checks and
avoid shipping generated artifacts or development credentials. The production
Compose overlay supplies mandatory secrets through environment interpolation,
keeps PostgreSQL and Redis on the private Compose network, restarts services
after transient failures and limits container resources.

Validate the rendered configuration before starting it:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml config
```
