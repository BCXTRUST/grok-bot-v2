# Self-hosting Rakazo

## Install

1. Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY`.
2. `pnpm sandbox:build` (or `docker compose -f infra/compose/docker-compose.yml up --build`) so `rakazo/computer:local` exists.
3. `docker compose -f infra/compose/docker-compose.yml up --build`
4. Open the web origin and create the first user. That user becomes the deployment owner.

Optional:

```env
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=you@example.com,@company.com
OPENROUTER_API_KEY=
E2B_API_KEY=
SANDBOX_PROVIDER=docker   # or fake | e2b | e2b-emulator. Product path is docker (or e2b). Keep fake only for pnpm verify:fast.
AGENT_RUNTIME=pi          # or scripted. Product path is pi. Keep scripted only for pnpm verify:fast.
```

## Backup

```bash
./scripts/backup.sh
```

This dumps Postgres (`pg_dump`) and archives `data/` into `backups/<stamp>/`.

## Restore

```bash
./scripts/restore.sh backups/<stamp>
```

## Upgrade

Pull the new image/source, run `pnpm --filter @rakazo/db migrate`, then restart API and worker. Product contracts stay compatible across cloud and self-hosted.
