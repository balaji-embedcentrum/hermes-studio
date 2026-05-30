# Migration Plan

Read **[00-OVERVIEW.md](00-OVERVIEW.md)** first. Short version: one shared project
(`packages/studio-core`) holding the whole app; two thin brand apps that differ only
by name/logo/theme, a `showMbseTools` flag, a workspace home page, and a landing page.

Execute on a machine with a **stable filesystem**. Each phase is one PR, **stacked in
order**. End every phase at a green `pnpm build` for both apps — never merge a phase
that doesn't build.

---

## Target layout

```
hermes-studio/
├── pnpm-workspace.yaml              # packages/*, apps/*
├── package.json                     # root: workspace scripts only
├── pnpm-lock.yaml                   # single lockfile
├── tsconfig.base.json
│
├── packages/
│   └── studio-core/                 # @studio/core — the entire app
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── components/ hooks/ lib/ server/ stores/ utils/ types/
│           ├── screens/             # incl. chat-v2
│           ├── routes/              # shared route IMPLEMENTATIONS (see note)
│           ├── sylang/              # symbol manager (shared)
│           ├── styles.css
│           └── brand/               # Brand type + useBrand() context
│
└── apps/
    ├── hermes/
    │   ├── package.json  tsconfig.json  vite.config.ts  server-entry.js
    │   ├── Dockerfile    docker-compose.prod.yml
    │   ├── public/                  # hermes-* assets
    │   └── src/
    │       ├── brand.config.ts      # Hermes brand, showMbseTools: false
    │       ├── WorkspaceHome.tsx     # Hermes workspace home
    │       ├── router.tsx  routeTree.gen.ts
    │       └── routes/
    │           ├── __root.tsx        # wraps app in <BrandProvider>
    │           ├── index.tsx         # Hermes landing
    │           └── *.tsx             # thin re-exports of @studio/core routes
    │
    └── sylang/                       # same shape; showMbseTools: true, Sylang home/landing
```

> **Routing note.** TanStack Start generates `routeTree.gen.ts` per app from that
> app's `src/routes`, so the route tree lives in the app. Most route files are
> **one-line re-exports** of the implementation in `@studio/core`. Only `index.tsx`
> (landing) and `__root.tsx` (brand provider) are real per-app files. `WorkspaceHome`
> is imported by the shared files screen from the app via brand config (see Phase 2).

---

## Phase 1 — Scaffold workspace + move shared code

**Branch:** `monorepo/phase-1-workspace`

1. Add `pnpm-workspace.yaml`, root `package.json` (scripts only), `tsconfig.base.json`.
2. Create `packages/studio-core` with a `package.json` whose `exports` mirror today's
   `@/*` subfolders (`./components/*`, `./hooks/*`, `./lib/*`, `./server/*`,
   `./stores/*`, `./screens/*`, `./routes/*`, `./brand`, `./styles.css`). Ship as
   **source** (no build step) — Vite/TanStack in each app transpiles it.
3. `git mv` **everything** into `packages/studio-core/src` — components, hooks, lib,
   server, stores, utils, types, screens, sylang, styles.css, **and** the shared
   route implementations. Sylang-only feature code (sylang-editor, spec-dash) moves
   here too — it's shared now.
4. Reconcile drift while moving: where a file differs between the two repos, commit
   the **newer (Sylang-ahead)** version as the shared one. (See "Reconciliation"
   below.) Skip the v1-chat files — Phase 3 deletes them.
5. Import rewrite: in app files `@/x` → `@studio/core/x`; inside the package keep
   `@/*` mapped to `packages/studio-core/src/*` (or use relative imports).
6. Create both apps (`apps/hermes`, `apps/sylang`), each with its own
   `vite.config.ts` / `tsconfig.json` / `server-entry.js`. Add `@studio/core` (and
   `@sylang/*`, `@jotx-labs/*`) to `ssr.noExternal`. Factor the shared
   hermes-agent / workspace-daemon dev-startup out of the vite config into
   `@studio/core` so both app configs call it.

**Gate:** `pnpm install` at root; **both** apps build:
```
pnpm --filter @studio/hermes... build
pnpm --filter @studio/sylang... build
```
Expect to iterate on `ssr.noExternal` / `optimizeDeps` until clean. PR only when both build.

---

## Phase 2 — Brand config (the four differences)

**Branch:** `monorepo/phase-2-brand`

`packages/studio-core/src/brand/types.ts`:
```ts
import type { ComponentType } from 'react'
import type { ThemeId } from '../lib/theme'

export interface Brand {
  id: 'hermes' | 'sylang'
  appTitle: string             // "Hermes Studio" | "Sylang Studio"
  legalName: string
  description: string
  logo: string                 // path under the app's public/
  iconHref: string             // favicon / crest
  themes: ThemeId[]
  defaultTheme: ThemeId
  loadingQuips: string[]
  showMbseTools: boolean       // diff #2 — Coverage/Traceability/FMEA nav
  WorkspaceHome: ComponentType // diff #3 — editor/workspace home page
}
```

`packages/studio-core/src/brand/brand-context.tsx`: a `BrandProvider` + `useBrand()`
(throws if used outside the provider).

`apps/hermes/src/brand.config.ts`:
```ts
import type { Brand } from '@studio/core/brand'
import { HermesHome } from './WorkspaceHome'
export const brand: Brand = {
  id: 'hermes',
  appTitle: 'Hermes Studio',
  legalName: 'Hermes Studio',
  description: 'Hermes Studio — AI agent workspace with chat, files, terminal, memory, and skills.',
  logo: '/hermes-crest.svg',
  iconHref: '/hermes-crest.svg',
  themes: ['hermes-official', 'hermes-official-light', 'hermes-classic', 'hermes-slate', 'hermes-mono'],
  defaultTheme: 'hermes-official',
  loadingQuips: ['Consulting the oracle…', 'Summoning Hermes…'],
  showMbseTools: false,
  WorkspaceHome: HermesHome,
}
```
`apps/sylang/src/brand.config.ts`: same shape with Sylang values, `defaultTheme:
'sylang-studio-light'`, `logo: '/sylang-logo.svg'`, `showMbseTools: true`,
`WorkspaceHome: SylangHome`.

**Wire-up (the four diffs):**
- **#1 identity:** each app's `__root.tsx` wraps the tree in `<BrandProvider brand={brand}>`.
  In `studio-core`, replace hardcoded title/theme/logo/quips (`__root.tsx`,
  `use-page-title.ts`, `login-screen.tsx`, `connection-startup-screen.tsx`,
  onboarding copy) with `useBrand()` reads. Theme registry (`lib/theme.ts`) holds all
  themes; brand picks `defaultTheme` + visible list. The Sylang theme-migration
  script runs only when `brand.id === 'sylang'`.
- **#2 MBSE header:** in the shared nav/header, gate the Coverage/Traceability/FMEA
  items behind `useBrand().showMbseTools`.
- **#3 workspace home:** the shared files screen renders `useBrand().WorkspaceHome`
  when no file is selected (instead of a hardcoded home).
- **#4 landing:** each app keeps its own `src/routes/index.tsx`.

**Gate:** both apps build and visibly differ in exactly the four ways; everything
else identical.

---

## Phase 3 — chat-v2 to core; retire v1

**Branch:** `monorepo/phase-3-chat-v2`

1. chat-v2 already moved into `studio-core/src/screens/chat-v2` in Phase 1.
2. Point both apps' chat route at chat-v2; remove the parallel `/chat-v2` route.
3. **Parity check before deleting v1** — confirm chat-v2 covers: streaming, tool/
   reasoning parts, attachments, session create/delete/rename, history hydration,
   abort/stop, context meter, mobile layout, message actions, realtime/pinned
   sessions. Port any genuine gap into chat-v2 first.
4. Delete v1 (`screens/chat/`); drop v1-only store/server paths only if unused by v2
   (v2 uses `/api/send-stream`).

**Gate:** both apps build; chat works end-to-end via chat-v2.

---

## Phase 4 — Two Dockerfiles, independent deploy

**Branch:** `monorepo/phase-4-docker`

Per-app Dockerfile, **build context = repo root**, `--filter` to the one app:
```dockerfile
# apps/sylang/Dockerfile  — build:  docker build -f apps/sylang/Dockerfile -t sylang-studio-web .
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/studio-core/package.json packages/studio-core/
COPY apps/sylang/package.json          apps/sylang/
RUN pnpm install --frozen-lockfile --filter @studio/sylang...
COPY . .
RUN pnpm --filter @studio/sylang build

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
```
`apps/hermes/Dockerfile` identical with `@studio/hermes`. Each app's
`docker-compose.prod.yml` = today's compose with `build.context: ../..` and
`build.dockerfile: apps/<app>/Dockerfile`. Point Sylang's existing VPS deploy
(`/root/deploy-sylang.sh`) at `apps/sylang`; Hermes deploys to its own host.

**Gate:** `docker build` succeeds for both from a clean checkout; each serves on
:3000 and passes `/api/ping`.

---

## Reconciliation (the "64 files differ" question)

Because both apps will run the same shared code, reconciliation is simple: for each
file that differs between the two repos today, the **shared** version is the
**newer / more complete one** (Sylang is generally ahead — it has bug-fixes and
features Hermes lacks). Take that version into `studio-core`.

Only these need special handling (they map to the four differences):

| Files | Handling |
|---|---|
| `routes/index.tsx` | Per-app landing (diff #4). Each app keeps its own. |
| `routes/__root.tsx`, `lib/theme.ts`, `use-page-title.ts`, `login-screen.tsx`, `connection-startup-screen.tsx`, onboarding copy | Brand identity (diff #1) → driven by `brand.config.ts` / `useBrand()`. |
| The MBSE nav items (in the header) | Brand flag (diff #2) → `showMbseTools`. |
| The workspace home view (today inside `routes/files.tsx`) | Per-app `WorkspaceHome` (diff #3). The rest of `files.tsx` — incl. Sylang/Spec/Dash/Jotx editor dispatch — is **shared, unchanged, in both**. |
| `screens/chat/*` (v1 chat) | Don't reconcile — Phase 3 deletes v1. |

Everything else: take the newer version as the shared one. No extraction, no plugin
registry, no per-app feature gating beyond the flag in diff #2.

---

## Merge order & watch-items

```
phase-1-workspace → phase-2-brand → phase-3-chat-v2 → phase-4-docker
```

- **TanStack Start + linked workspace package:** the main iteration cost is
  `ssr.noExternal` / `optimizeDeps` until Vite transpiles `@studio/core` cleanly.
- **Single lockfile:** regenerate `pnpm-lock.yaml` once at root; delete per-repo locks.
- **`@sylang/*` packages** ship in **both** apps now (they're shared features).
- **Uncommitted WIP:** `feat/workspace-chat-polish` has uncommitted server-side work.
  Land or rebase it **before** Phase 1's big file move, or it conflicts with the
  relocation.
- **Local git health:** a corrupt packfile (May 12) exists in `.git` — `git fsck` /
  re-fetch on a stable machine before doing the heavy work.
