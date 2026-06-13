# Build context: monorepo root
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.10.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages packages
COPY apps/console apps/console
RUN pnpm install --frozen-lockfile

ARG NUXT_PUBLIC_API_BASE
ARG NUXT_PUBLIC_TENANT=kisip
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE
ENV NUXT_PUBLIC_TENANT=$NUXT_PUBLIC_TENANT

RUN pnpm --filter @egrm/core build \
 && pnpm --filter @egrm/config-schemas build \
 && pnpm --filter @egrm/console build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/console/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
