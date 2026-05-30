# Sylang Studio — build from the REPO ROOT:
#   docker build -f apps/sylang/Dockerfile -t sylang-studio-web .
#
# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Manifests first for cached installs.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/studio-core/package.json packages/studio-core/
COPY apps/sylang/package.json          apps/sylang/
RUN pnpm install --frozen-lockfile --filter @studio/sylang...

# Then the sources, and build just this app (+ its @studio/core dep).
# The sylang app's build also runs the @sylang/* public-asset sync (see its
# package.json prebuild script).
COPY . .
RUN pnpm --filter @studio/sylang build

# --- Production stage ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S studio && adduser -S studio -G studio

COPY --from=builder /app/apps/sylang/dist          ./dist
COPY --from=builder /app/apps/sylang/node_modules  ./node_modules
COPY --from=builder /app/apps/sylang/package.json  ./
COPY --from=builder /app/apps/sylang/server-entry.js ./

EXPOSE 3000
USER studio
CMD ["node", "server-entry.js"]
