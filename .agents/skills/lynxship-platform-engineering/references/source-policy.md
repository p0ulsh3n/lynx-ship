# Current-source policy for LynxShip platform work

This repository is not self-updating. Before relying on an external API,
check its current official documentation and the version locked in this
repository. Record the URL, version or commit, and date in the change notes
when the decision affects compatibility or security.

## Primary sources

- Fastify: https://fastify.dev/docs/latest/
- Node.js: https://nodejs.org/en/docs
- TypeScript: https://www.typescriptlang.org/docs/
- pnpm: https://pnpm.io/
- PostgreSQL: https://www.postgresql.org/docs/current/
- node-postgres: https://node-postgres.com/
- Redis Node client: https://redis.io/docs/latest/develop/clients/nodejs/
- node-redis source: https://github.com/redis/node-redis
- Cloudflare R2: https://developers.cloudflare.com/r2/
- R2 S3 API: https://developers.cloudflare.com/r2/api/s3/api/
- R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- GitHub Actions: https://docs.github.com/en/actions
- GitHub Actions security hardening: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- OpenAPI: https://spec.openapis.org/oas/latest.html
- OWASP API Security: https://owasp.org/API-Security/
- Webhook delivery validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- React: https://react.dev/
- Vite: https://vite.dev/guide/
- TanStack Router: https://tanstack.com/router/latest
- TanStack Query: https://tanstack.com/query/latest
- Tailwind CSS: https://tailwindcss.com/docs
- shadcn/ui: https://ui.shadcn.com/docs

Use official provider documentation for any new store, identity, database,
queue, or observability integration. Do not infer a provider API from a blog,
an old answer, generated code, or a package name alone. Do not scrape private
or access-controlled content. A link being reachable is not proof that its
semantics match this repository.

## Version review procedure

For a dependency or provider upgrade:

1. Read the official release notes and migration guide for the target version.
2. Compare the installed lockfile and package declarations with the target.
3. Search the repository for affected APIs, adapters, environment variables,
   and serialized fields.
4. Update tests and compatibility notes before changing production defaults.
5. Run `pnpm check`, `pnpm verify`, and the relevant live integration checks.
6. Record unsupported platforms or provider capabilities explicitly.

The weekly link audit can find dead URLs, redirects, or HTTP failures. It
cannot determine whether an API changed meaning. A human or coding agent must
still perform the version review above.
