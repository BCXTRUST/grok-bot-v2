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
pnpm --filter @rakazo/db exec prisma db push
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Bring your own model key (OpenRouter by default). Rakazo does not pay for user model usage.

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
