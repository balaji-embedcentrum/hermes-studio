# Phase 1 — Scaffold (what's in this branch, what's left)

This branch lays down the **new** Phase-1 files that don't depend on moving the
existing source: the pnpm workspace, the `@studio/core` package shell, the
**brand-abstraction layer**, the two per-app brand configs + `WorkspaceHome` stubs,
and the two Dockerfiles. See [00-OVERVIEW.md](00-OVERVIEW.md) and
[01-migration-plan.md](01-migration-plan.md) for the full model and plan.

> **This branch does not build on its own yet.** It is the skeleton. The big
> mechanical step — moving ~290 shared files into `packages/studio-core` and wiring
> the two apps — must be done on a machine with a healthy filesystem and git (see
> "Why this is a scaffold" below), then verified with `pnpm build`.

## In this branch

```
pnpm-workspace.yaml
package.json                                  # root workspace scripts
tsconfig.base.json
packages/studio-core/
  package.json                                # exports map; deps filled during the move
  tsconfig.json
  src/brand/
    types.ts                                  # Brand interface (the 4-difference seam)
    brand-context.tsx                         # BrandProvider + useBrand()
    index.ts
apps/hermes/
  src/brand.config.ts                         # Hermes brand, showMbseTools: false
  src/WorkspaceHome.tsx                        # stub
  Dockerfile                                   # build from repo root, --filter @studio/hermes
apps/sylang/
  src/brand.config.ts                         # Sylang brand, showMbseTools: true
  src/WorkspaceHome.tsx                        # stub
  Dockerfile                                   # build from repo root, --filter @studio/sylang
docs/monorepo/PHASE-1-SCAFFOLD.md             # this file
```

## Remaining Phase-1 steps (on a healthy machine)

Run from the repo root. The shared-everything model means **almost everything**
moves into core unchanged.

1. **Move shared source into core** (use `git mv` so history follows):
   ```
   git mv src/components src/hooks src/lib src/server src/stores src/utils \
          src/types src/screens src/sylang src/styles.css \
          packages/studio-core/src/
   git mv src/routes packages/studio-core/src/routes      # shared route impls
   ```
   Keep per-app only: `routes/index.tsx` (landing), `routes/__root.tsx` (brand
   provider), `router.tsx`, `routeTree.gen.ts`, and the workspace home (now in
   `apps/*/src/WorkspaceHome.tsx`).

2. **Reconcile drift while moving** — where a file differs between `hermes-studio`
   and `hermes-studio-sylang`, commit the **newer (Sylang-ahead)** version as the
   shared one. Skip `screens/chat/*` (v1 chat — deleted in Phase 3).

3. **Fill `packages/studio-core/package.json` `dependencies`** from the current
   `hermes-studio/package.json` (react, react-dom, @tanstack/*, @supabase/*,
   zustand, lucide-react, clsx, tailwind-merge, marked, codemirror, xterm, etc.).

4. **Create each app's** `package.json`, `tsconfig.json`, `vite.config.ts`,
   `server-entry.js`, `public/`, `routeTree.gen.ts`, and the thin `routes/*` shells
   (one-line re-exports of `@studio/core` route impls). Base `vite.config.ts` on the
   current `hermes-studio/vite.config.ts`; add `@studio/core` to `ssr.noExternal`;
   factor the shared hermes-agent / workspace-daemon dev-startup into
   `@studio/core/server-runtime` and call it from both. Ports: hermes 3002, sylang 3000.

5. **Import rewrite** in app files: `@/x` → `@studio/core/x` (codemod). Inside core,
   keep `@/*` mapped to `packages/studio-core/src/*` (already set in its tsconfig).

6. **Single lockfile**: `pnpm install` at root; delete the two per-repo
   `pnpm-lock.yaml` files.

7. **Gate**: both apps build —
   ```
   pnpm --filter @studio/hermes... build
   pnpm --filter @studio/sylang... build
   ```
   Iterate on `ssr.noExternal` / `optimizeDeps` until clean. Then Phase 2 wires the
   four brand differences through `useBrand()`.

## Why this is a scaffold (not the full move)

The migration was attempted in an automated session whose sandbox **could not
perform bulk filesystem operations** — `git worktree` and `git clone` hung/failed
mid-checkout, and the existing local `.git` has a **corrupt packfile** (`git status`
fails with "bad object HEAD"; `git rev-parse HEAD` works). Moving ~290 files +
`pnpm install` + building all need a healthy FS and git, so those steps were left
for a stable machine. This branch (the new files only) was created and pushed via
the GitHub API to avoid the broken local git.

**Before running the steps above:** heal local git (`git fsck`, re-fetch, or a fresh
clone) and land/rebase the uncommitted WIP on `feat/workspace-chat-polish` (it
touches `src/server/*` files that move in step 1).
