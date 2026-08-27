# Environment and restoration guide

This document records the **names and roles** of Kronos Guard configuration variables. It intentionally contains no real credential, token, password, database hostname, or webhook secret.

## Required configuration

| Variable | Purpose | Where to set it |
| --- | --- | --- |
| `DATABASE_URL` | MySQL/TiDB-compatible database connection | Server/deployment secret manager |
| `JWT_SECRET` | Signs application sessions | Server/deployment secret manager |
| `TELEGRAM_BOT_TOKEN` | Authenticates the Telegram bot | Server/deployment secret manager |
| `TELEGRAM_WEBHOOK_SECRET` | Verifies Telegram webhook traffic | Server/deployment secret manager |
| `TELEGRAM_PUBLIC_BASE_URL` | Public HTTPS root URL used for the Telegram webhook and Mini App | Server/deployment secret manager |
| `OWNER_TELEGRAM_ID` | Telegram chat ID that can administer the bot and receive critical alerts | Server/deployment secret manager |
| `OWNER_OPEN_ID` | Identifies the application owner | Server/deployment secret manager |
| `OWNER_NAME` | Owner display name | Server/deployment secret manager |

## Mini App and OAuth configuration

| Variable | Purpose |
| --- | --- |
| `VITE_APP_ID` | Manus application identifier used by the Mini App |
| `OAUTH_SERVER_URL` | OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Client-side OAuth portal URL |
| `VITE_APP_TITLE` | Browser/Mini App title |
| `VITE_APP_LOGO` | Optional logo URL |

## Manus service gateway configuration

| Variable | Purpose |
| --- | --- |
| `BUILT_IN_FORGE_API_URL` | Server-side Manus service gateway |
| `BUILT_IN_FORGE_API_KEY` | Server-side gateway credential |
| `VITE_FRONTEND_FORGE_API_URL` | Browser-facing Manus service gateway |
| `VITE_FRONTEND_FORGE_API_KEY` | Browser-facing gateway credential |

## Optional configuration

| Variable | Purpose |
| --- | --- |
| `VITE_ANALYTICS_ENDPOINT` | Analytics collection endpoint |
| `VITE_ANALYTICS_WEBSITE_ID` | Analytics website identifier |
| `NOWPAYMENTS_API_KEY` | Optional payment-provider integration, if enabled |

## What is restored from Git

The repository contains the source tree, package lockfile, tests, database schema, and the cumulative Drizzle migrations. Applying the migrations recreates the **structure** of the database; it does not restore a production database’s user, chat, payment, or message data.

If production data needs to be migrated, create an encrypted database backup through the database provider with an access-controlled retention policy. Do not store database exports or secret files in Git.

## Pre-deploy checklist

1. Copy `config/environment.template` to `.env` locally, then confirm `.env` is ignored with `git check-ignore .env`.
2. Confirm no `.env`, private key, token, or database dump is staged with `git status --ignored` and `git diff --cached`.
3. Run `pnpm test && pnpm check && pnpm build`.
4. Configure the new environment’s Telegram webhook and OAuth callback URLs.
5. Rotate any credential suspected to have been exposed before transfer.
