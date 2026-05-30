# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json pnpm-lock.yaml .npmrc ./
RUN npm install -g pnpm && pnpm install --no-frozen-lockfile

COPY . .
# Sync the @sylang editor bundles from node_modules into public/ AFTER the
# source copy. The public/sylang-* dirs are no longer vendored in git, and
# `postinstall` runs before `COPY . .` (so a stale bundle from the VPS
# working tree could overlay it). This explicit, idempotent sync makes the
# bundle deterministic regardless of pnpm pre/post-script settings.
RUN pnpm sync:editors:npm && pnpm build

# --- Production stage ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S hermes && adduser -S hermes -G hermes

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server-entry.js ./

EXPOSE 3000

USER hermes

CMD ["node", "server-entry.js"]

