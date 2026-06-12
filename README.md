# eGRM Platform

Generic, multi-tenant electronic Grievance Redress Mechanism. Specifications live in [`specs/`](specs/README.md); this repo is the implementation (development plan: spec 12).

## Stack

- **apps/portal** — public portal (Nuxt 4 + Nuxt UI, SSR)
- **apps/console** — staff & admin console (Nuxt 4 + Nuxt UI, SPA)
- **apps/api** — REST API (Fastify + Drizzle + PostgreSQL): tenancy, auth, config registry, workflow engine
- **apps/worker** — background jobs (BullMQ + Redis): outbox, SLA scheduler, retention
- **packages/core** — semantic tags, permission catalogue, shared types
- **packages/config-schemas** — zod schemas for the CD-01…CD-16 config domains

## Getting started (plain local services — no Docker for now)

Prerequisites: Node 22+, pnpm 9+, a local PostgreSQL 16 server on `localhost:5432`.

```bash
pnpm install
# create the dev database once:  createdb -U postgres egrm
cp .env.example apps/api/.env          # set your local Postgres password in DATABASE_URL
pnpm --filter @egrm/api db:generate    # first time / after schema changes
pnpm db:migrate
pnpm db:seed                           # KISIP reference tenant + admin user
pnpm dev                               # api :4100, console :3100, portal :3200
```

Seeded login (console): `admin@kisip.local` / `ChangeMe!2026`.

The worker (`pnpm dev:worker`) is excluded from `pnpm dev` until Phase 2 — it needs a Redis-compatible server (e.g. Memurai on Windows). Containerization comes back at deployment time.
