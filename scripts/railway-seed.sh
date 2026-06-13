#!/usr/bin/env bash
# Seed the Railway Postgres database for @egrm/api and print console login details.
#
# Prerequisites: railway CLI logged in, pnpm installed, repo root as cwd.
# Usage:
#   ./scripts/railway-seed.sh
#   ./scripts/railway-seed.sh --bootstrap   # migrate + seed (when DB empty)
#
# Override defaults:
#   SEED_TENANT_HOSTNAMES="portal.example.com,console.example.com" ./scripts/railway-seed.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Seeded credentials (must match apps/api/src/db/seed.ts) ─────────────────
SEED_TENANT="${SEED_TENANT:-kisip}"
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@kisip.local}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ChangeMe!2026}"

# ── Railway targets ─────────────────────────────────────────────────────────
RAILWAY_SERVICE="${RAILWAY_SERVICE:-@egrm/api}"
SEED_TENANT_HOSTNAMES="${SEED_TENANT_HOSTNAMES:-egrmportal-production.up.railway.app,egrmconsole-production.up.railway.app}"
CONSOLE_URL="${CONSOLE_URL:-https://egrmconsole-production.up.railway.app}"
PORTAL_URL="${PORTAL_URL:-https://egrmportal-production.up.railway.app}"

MODE="seed"
if [[ "${1:-}" == "--bootstrap" ]]; then
  MODE="bootstrap"
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: $0 [--bootstrap]"
  echo "  (default)  pnpm db:seed via railway run"
  echo "  --bootstrap  pnpm db:bootstrap (migrate + conditional seed)"
  exit 0
fi

if ! command -v railway >/dev/null 2>&1; then
  echo "error: railway CLI not found. Install: https://docs.railway.com/develop/cli" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm not found." >&2
  exit 1
fi

echo "==> Railway seed (${MODE})"
echo "    service:  ${RAILWAY_SERVICE}"
echo "    tenant:   ${SEED_TENANT}"
echo "    hosts:    ${SEED_TENANT_HOSTNAMES}"
echo ""

echo "==> Setting SEED_TENANT_HOSTNAMES on ${RAILWAY_SERVICE}…"
railway variables set "SEED_TENANT_HOSTNAMES=${SEED_TENANT_HOSTNAMES}" --service "${RAILWAY_SERVICE}"

echo "==> Running db:${MODE}…"
if [[ "$MODE" == "bootstrap" ]]; then
  railway run --service "${RAILWAY_SERVICE}" pnpm db:bootstrap
else
  railway run --service "${RAILWAY_SERVICE}" pnpm db:seed
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Seed finished — use these credentials on the staff console"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Tenant:    ${SEED_TENANT}"
echo "  Email:     ${SEED_ADMIN_EMAIL}"
echo "  Password:  ${SEED_ADMIN_PASSWORD}"
echo ""
echo "  Console:   ${CONSOLE_URL}/login"
echo "  Portal:    ${PORTAL_URL}/"
echo ""
echo "  Change the password after first login in production."
echo "══════════════════════════════════════════════════════════════"
