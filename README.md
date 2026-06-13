# eGRM Platform

Generic, multi-tenant electronic Grievance Redress Mechanism. Specifications live in [`specs/`](specs/README.md); this repo is the implementation (development plan: spec 12).

## Stack

- **apps/portal** — public portal (Nuxt 4 + Nuxt UI, SSR)
- **apps/console** — staff & admin console (Nuxt 4 + Nuxt UI, SPA)
- **apps/api** — REST API (Fastify + Drizzle + PostgreSQL): tenancy, auth, config registry, workflow engine
- **apps/worker** — background jobs (Phase 2+): SLA scheduler, retention
- **packages/core** — semantic tags, permission catalogue, shared types
- **packages/config-schemas** — zod schemas for the CD-01…CD-16 config domains

## Getting started (plain local services — no Docker for now)

Prerequisites: Node 22+, pnpm 9+, a local PostgreSQL 16 server on `localhost:5432`.

```bash
pnpm install
pnpm db:setup    # creates apps/api/.env on first run; set DATABASE_URL password and re-run if prompted
pnpm dev         # api :4100, console :3100, portal :3200
```

`pnpm db:setup` creates the `egrm` database if missing, applies all migrations, and seeds the reference tenant. After schema changes, use `pnpm db:migrate` (and `pnpm db:seed` to refresh seed data). Production/Railway uses `db:bootstrap` (migrate + conditional seed) automatically on API deploy.

Seeded login (console): `admin@kisip.local` / `ChangeMe!2026`.

The worker (`pnpm dev:worker`) is excluded from `pnpm dev` until Phase 2 — notifications currently dispatch inline in the API.

## Deploy to Railway

See [`docs/deploy-railway.md`](docs/deploy-railway.md) for Docker-based deployment of **api**, **portal**, and **console** with PostgreSQL.
