# Build context must be the monorepo root (set in Railway service settings).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.10.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @egrm/core build \
 && pnpm --filter @egrm/config-schemas build \
 && pnpm --filter @egrm/api build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api
ENV HOST=0.0.0.0
EXPOSE 4100
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
