# Rakazo

Open-source home for persistent AI bots that can do real work. Each bot has one thread, one computer, memory, routines, and history.

This repository is the complete core product. It runs without a Rakazo-operated control plane.

## Requirements

- Node.js 22+
- pnpm 9
- Docker (Postgres, optional graphical sandbox)

## Quick start

```bash
cp .env.example .env
docker compose -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts the API, Graphile Worker, web app, and sandbox supervisor. Product wakeups default to Graphile Worker so a run continues if the API process restarts. `pnpm verify:fast` still forces `WAKEUP_DRIVER=memory`.

If this Postgres was created with `prisma db push` before checked-in migrations existed, mark the baseline once:

```bash
pnpm --filter @rakazo/db exec prisma migrate resolve --applied 0001_init
```

## Verify

```bash
pnpm verify:fast    # unit, property, and in-process contract tests
pnpm verify         # Postgres via Testcontainers, emulators, API, Playwright
pnpm verify:providers  # optional live OpenRouter / E2B canaries
```

Default verification uses a scripted agent runtime and sandbox emulators. It does not need SaaS credentials.

## Layout

```
apps/web api worker desktop mobile
packages/core contracts db auth memory ui-web adapter-kit adapters testkit
infra/compose sandboxes
```

## Self-host

See `docs/self-host.md`. Cloud and self-hosted editions share the same application and contracts.
