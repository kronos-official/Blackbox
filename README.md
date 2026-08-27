# Kronos Guard

**Kronos Guard** is a Telegram group-management bot and Persian-first Mini App. The repository contains the application source, database schema and migrations, Telegram bot handlers, dashboard, tests, and production build configuration.

## Included components

| Area | Included in this repository |
| --- | --- |
| Telegram bot | Telegraf handlers, moderation, permissions, forced membership, schedules, commands, notifications, and activity logging |
| Mini App | React 19 dashboard, Persian RTL interface, user and owner panels, notification center, responsive theming, and public crypto-market panel |
| Market panel | Real public-source pricing, USD/Toman conversion, 24-hour change indicators, searchable assets, and real-data line/candlestick charts |
| Backend | Express, tRPC, authentication, secure scheduled routes, audit logs, and database helpers |
| Database | Drizzle schema and all generated non-destructive migrations under `drizzle/` |
| Verification | Vitest test suite, TypeScript checks, and production build scripts |

> **Security note:** This repository deliberately does not contain a real `.env`, tokens, passwords, OAuth credentials, webhook secrets, or a production database dump. Private Git repositories retain commit history and can be copied, exposed through integrations, or accidentally made public. Use your deployment provider’s secret manager for real values.

## Local setup

```bash
pnpm install
cp config/environment.template .env
# Fill .env locally; do not commit it.
pnpm db:push
pnpm dev
```

The development server starts from `server/_core/index.ts`. Run the following verification commands before deploying changes:

```bash
pnpm test
pnpm check
pnpm build
```

## Restore the application

1. Clone the private repository.
2. Install the pinned dependency graph with `pnpm install`.
3. Copy `config/environment.template` to `.env` and add the real values through a local secret manager or hosting-provider secrets panel.
4. Provision a MySQL/TiDB-compatible database, set `DATABASE_URL`, and run `pnpm db:push` to apply the included Drizzle migrations.
5. Configure the Telegram webhook and Mini App/OAuth URLs for the target environment.
6. Run `pnpm test && pnpm check && pnpm build`, then deploy.

For a field-by-field explanation of the environment template and the restoration boundaries, see [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Repository layout

```text
client/     React Mini App and UI components
server/     Express/tRPC backend, Telegram handlers, scheduled endpoints, tests
drizzle/    Drizzle schema, migration journal, and generated SQL migrations
shared/     Shared types and constants
scripts/    Build and documentation helper scripts
```

## Secret handling

Real values remain outside Git. The required variable names are documented in `config/environment.template`; no token needs to be copied into source control to restore the application. If a credential has ever been committed elsewhere, rotate it in the issuing service before using it again.
