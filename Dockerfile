# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Vite/Rollup chunk rendering for this app needs more than Node's ~2GB default.
ENV NODE_OPTIONS=--max-old-space-size=4096

# Brand selection — one engine, two products. Build the Hermes image with
#   docker build --build-arg VITE_BRAND=hermes .
# Defaults to Sylang. studio-apps passes this per brand.
ARG VITE_BRAND=sylang
ENV VITE_BRAND=$VITE_BRAND

COPY package.json pnpm-lock.yaml .npmrc ./
# Patches must be present before install: pnpm 9 applies patchedDependencies
# (@jotx-labs/editor) during `pnpm install`, reading patches/ from the cwd.
COPY patches ./patches
# Pin pnpm 9 (matches lockfileVersion 9.0). pnpm 10/11 no longer read the
# "pnpm" field in package.json, silently dropping our overrides + the
# @jotx-labs/editor patch; pnpm 9 honors them and has no build-script gate.
# --ignore-scripts: dependency build scripts aren't needed at install time
# (esbuild/unrs-resolver ship prebuilt binaries as optional deps; core-js'
# script only prints a notice), and the editor sync + build run explicitly
# after `COPY . .` below. Patches still apply (patching isn't a script).
RUN npm install -g pnpm@9 && pnpm install --no-frozen-lockfile --ignore-scripts

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

