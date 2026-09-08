# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the Strix/NovaHunter Next.js 16 dashboard.
# Produces a small self-contained runtime image based on the Next.js
# `standalone` output. Node 22 LTS is used to satisfy the Next 16 runtime
# requirement (>= 20.9) with room for future upgrades.

ARG NODE_IMAGE=node:22-alpine

# --- Dependencies (cached layer) ---------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

# --- Build -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time values that must be baked into the client bundle. These are
# overridden from deploy/docker-compose.yml's `build.args:` block.
ARG NEXT_PUBLIC_DEMO=false
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_NAME=NovaHunter
ENV NEXT_PUBLIC_DEMO=$NEXT_PUBLIC_DEMO \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
RUN npm run build

# --- Runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Required by Next.js sharp/image optimisation on Alpine.
RUN apk add --no-cache libc6-compat wget \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy the standalone output + static assets.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
