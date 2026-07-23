# syntax=docker/dockerfile:1

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY scripts ./scripts
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY apps/docs/package.json ./apps/docs/
COPY packages/schema/package.json ./packages/schema/
COPY packages/ui/package.json ./packages/ui/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

ARG VITE_ZERO_CACHE_URL=http://localhost:4848
ENV VITE_ZERO_CACHE_URL=$VITE_ZERO_CACHE_URL
RUN pnpm turbo run build --filter=@yapm/server --filter=@yapm/web
RUN pnpm deploy --filter=@yapm/server --prod --legacy /app

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_DIST_DIR=/app/web
WORKDIR /app

RUN groupadd --system --gid 1001 yapm \
    && useradd --system --uid 1001 --gid yapm yapm

COPY --from=build --chown=yapm:yapm /app /app
COPY --from=build --chown=yapm:yapm /repo/apps/web/dist /app/web

USER yapm
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
