# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json pnpm-lock.yaml .npmrc ./
# pnpm pinned to v9: an unpinned (newer) pnpm hard-errors on
# ERR_PNPM_IGNORED_BUILDS. v9 matches pnpm-lock.yaml (lockfileVersion 9.0)
# and runs dependency build scripts by default — do not un-pin.
RUN npm install -g pnpm@9 && pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

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

