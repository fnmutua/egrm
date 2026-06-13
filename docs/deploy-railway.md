# Deploying eGRM on Railway

This guide deploys three services from the monorepo:

| Service | Dockerfile | Public URL purpose |
|---------|------------|-------------------|
| **api** | `apps/api/Dockerfile` | REST API (`/health`, `/api/v1/...`) |
| **portal** | `apps/portal/Dockerfile` | Public grievance portal (SSR) |
| **console** | `apps/console/Dockerfile` | Staff / admin console (SPA) |

PostgreSQL is required. Redis + worker are optional (not needed for core testing).

---

## 1. Create the Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select `egrm`.
2. Add **PostgreSQL** from the project canvas (**+ New** → **Database** → **PostgreSQL**).

---

## 2. API service

1. **+ New** → **GitHub Repo** → same repo (or **Empty Service** and connect repo).
2. Open the service → **Settings**:
   - **Config file path**: `apps/api/railway.toml`
   - Root directory stays **empty** (repo root — Docker build context must include `packages/`).
3. **Variables** (link Postgres first):

   | Variable | Value |
   |----------|-------|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference from Postgres plugin) |
   | `DATABASE_PUBLIC_URL` | `${{Postgres.DATABASE_PUBLIC_URL}}` (required for `railway run` db commands from your PC) |
   | `JWT_SECRET` | long random string (32+ chars) |
   | `PII_SECRET` | different long random string (32+ chars) |
   | `DEFAULT_TENANT` | `kisip` |
   | `NODE_ENV` | `production` |

4. **Settings → Networking** → **Generate Domain** (e.g. `egrm-api-production.up.railway.app`).
5. Deploy. Before each deployment Railway runs **`preDeployCommand`**: migrations, then seed on first deploy (empty database).

Optional variables:

| Variable | Value |
|----------|-------|
| `SEED_TENANT_HOSTNAMES` | `your-portal.up.railway.app,your-console.up.railway.app` (merged into tenant on seed) |
| `SEED_ON_DEPLOY` | `1` to force seed every deploy; `0` to never seed on deploy (default: seed only when no tenants exist) |
| `PUBLIC_PORTAL_BASE_URL` | `https://your-portal.up.railway.app` (tracking links in notifications) |

### Seed behaviour on deploy

| Deploy | What runs |
|--------|-----------|
| **First** (empty Postgres) | `migrate` → `seed` (KISIP tenant, admin user, config packs) |
| **Later** (data exists) | `migrate` only |
| **Force re-seed** | Set `SEED_ON_DEPLOY=1` and redeploy, or run manually (below) |

Seeded login: `admin@kisip.local` / `ChangeMe!2026`

### Manual seed (hostnames, force refresh)

After portal/console domains exist, merge hostnames without a full redeploy:

```bash
railway login
railway link          # pick project + **api** service (not console)
railway run pnpm db:bootstrap   # migrate + seed when DB empty
# or:
railway run pnpm db:migrate
railway run pnpm db:seed
```

Compiled API image (no tsx on the host):

```bash
railway run -- node dist/db/bootstrap.js
```

`railway run` executes on your machine with API env vars injected. The API auto-uses `DATABASE_PUBLIC_URL` when the internal `postgres.railway.internal` host is unreachable. Link both Postgres variables on the API service (see table above).

To merge portal/console hostnames into the seeded tenant:

```bash
railway variables set SEED_TENANT_HOSTNAMES="your-portal.up.railway.app,your-console.up.railway.app"
railway run pnpm db:seed
```

---

## 3. Portal service

1. **+ New** → same repo.
2. **Settings → Config file path**: `apps/portal/railway.toml`
3. **Variables** (set **before** or redeploy after — Nuxt bakes these at build time):

   | Variable | Example |
   |----------|---------|
   | `NUXT_PUBLIC_API_BASE` | `https://egrm-api-production.up.railway.app` |
   | `NUXT_PUBLIC_TENANT` | `kisip` |
   | `NODE_ENV` | `production` |

4. **Generate Domain** for the portal.

---

## 4. Console service

1. **+ New** → same repo.
2. **Settings → Config file path**: `apps/console/railway.toml`
3. **Variables**:

   | Variable | Example |
   |----------|---------|
   | `NUXT_PUBLIC_API_BASE` | `https://egrm-api-production.up.railway.app` |
   | `NUXT_PUBLIC_TENANT` | `kisip` |
   | `NODE_ENV` | `production` |

4. **Generate Domain** for the console.

---

## 5. Finish tenant hostnames

If you deployed before generating portal/console domains, set hostnames and re-seed:

```bash
railway link   # api service
railway variables set SEED_TENANT_HOSTNAMES="portal-xxx.up.railway.app,console-xxx.up.railway.app"
railway run -- node dist/db/seed.js
```

Or set `SEED_ON_DEPLOY=1`, redeploy the API once, then set `SEED_ON_DEPLOY=0` (or remove it) so later deploys only migrate.

The Nuxt apps always send `x-tenant: kisip`, so API calls work even without hostname mapping — hostnames matter for direct API access and future hostname-based routing.

---

## 6. Smoke test

| Check | URL |
|-------|-----|
| API health | `https://<api-domain>/health` |
| Public intake meta | `https://<api-domain>/api/v1/public/intake-meta` with header `x-tenant: kisip` |
| Portal home | `https://<portal-domain>/` |
| Console login | `https://<console-domain>/login` |

---

## Environment reference

### API (`apps/api`)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Auth token signing |
| `PII_SECRET` | yes | PII encryption — **never change after data exists** |
| `DEFAULT_TENANT` | no | Fallback tenant code (default `kisip`) |
| `PORT` | auto | Injected by Railway — do not set manually |
| `SEED_TENANT_HOSTNAMES` | no | Comma-separated Railway domains (merged on seed) |
| `SEED_ON_DEPLOY` | no | `1` = seed every deploy; `0` = never; unset = seed only when DB empty |
| `REDIS_URL` | no | Only needed when worker is deployed |

### Portal / Console

| Variable | Required | Notes |
|----------|----------|-------|
| `NUXT_PUBLIC_API_BASE` | yes | Full URL of the API service (no trailing slash) |
| `NUXT_PUBLIC_TENANT` | no | Default `kisip` |

---

## Troubleshooting

**Build fails on Nuxt with wrong API URL**  
`NUXT_PUBLIC_*` vars must be set before deploy. Change them → **Redeploy**.

**421 unknown_tenant**  
Run seed, or set `DEFAULT_TENANT=kisip`, or send `x-tenant: kisip` header.

**Healthcheck fails / API never becomes healthy**  
Check **Deploy logs** (not build logs) for `[migrate] failed:` or `[server] starting`. Common causes:

- `DATABASE_URL` not linked — use `${{Postgres.DATABASE_URL}}` on the API service.
- `JWT_SECRET` / `PII_SECRET` missing — set both before deploy.
- Migration error — fix SQL/DB state, then redeploy (migrations run in `preDeployCommand` via `dist/db/bootstrap.js`).
- Seed skipped on redeploy — expected; set `SEED_ON_DEPLOY=1` once or `railway run -- node dist/db/seed.js`.

**Database connection errors**  
On the API service, link both `${{Postgres.DATABASE_URL}}` (deploy / internal) and `${{Postgres.DATABASE_PUBLIC_URL}}` (for `railway run` from your PC). Deployed containers use the internal URL automatically; local `railway run` falls back to the public proxy. If using an external URL, append `?sslmode=require`.

**`Cannot resolve PostgreSQL host (postgres.railway.internal)`**  
You ran a db command locally without `DATABASE_PUBLIC_URL` on the API service, or linked the **console** service instead of **api**. Fix: add `DATABASE_PUBLIC_URL=${{Postgres.DATABASE_PUBLIC_URL}}` on the API service, `railway link` to **api**, then `railway run pnpm db:migrate`. Or use `railway shell` (runs inside Railway's network).

**CORS**  
API allows all origins in dev/test (`origin: true`). Tighten in production when domains are final.

---

## Optional: Worker + Redis

For background jobs (SLA scheduler, outbox):

1. Add **Redis** plugin.
2. Deploy a fourth service with `apps/worker/Dockerfile` (not included yet — worker is Phase 2).
3. Set `REDIS_URL=${{Redis.REDIS_URL}}` on API and worker.

For initial Railway testing, skip worker and Redis.
