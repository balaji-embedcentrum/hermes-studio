# Migration Runbook — Phases 1–5

Execute on a machine with a **stable filesystem**. Each phase is one PR, **stacked
in order** (branch each phase off the previous merged state). End every phase at a
green `pnpm build` for the affected app(s) — never merge a phase that doesn't build.

Branch naming: `monorepo/phase-N-<slug>`. PR base: previous phase's branch (or
`main` once the prior phase is merged).

---

## Target layout (end state)

```
hermes-studio/                         # same repo, restructured
├── pnpm-workspace.yaml
├── package.json                       # root: workspace scripts only, no app deps
├── pnpm-lock.yaml                     # single lockfile for the whole workspace
├── tsconfig.base.json                 # shared compiler options
├── .npmrc
├── docs/monorepo/                     # these docs
│
├── packages/
│   └── studio-core/                   # @studio/core — the shared ~80%
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── components/  hooks/  lib/  server/  stores/  utils/  types/
│           ├── screens/               # generic screens incl. chat-v2 (Phase 4)
│           ├── brand/                  # Brand interface + context (Phase 2)
│           │   ├── types.ts
│           │   └── brand-context.tsx
│           ├── plugins/               # registries (Phase 3)
│           │   ├── editor-registry.ts
│           │   ├── nav-registry.ts
│           │   └── file-lifecycle.ts
│           └── server-runtime/        # shared server-entry/vite helpers
│
└── apps/
    ├── hermes/                        # @studio/hermes
    │   ├── package.json   tsconfig.json   vite.config.ts   server-entry.js
    │   ├── Dockerfile     docker-compose.prod.yml
    │   ├── public/                    # hermes-* assets
    │   └── src/
    │       ├── router.tsx  routeTree.gen.ts  styles.css
    │       ├── brand.config.ts        # Hermes brand + (no) plugins
    │       └── routes/                # thin shells → @studio/core screens
    │           ├── __root.tsx  index.tsx  (+ re-exports)
    │
    └── sylang/                        # @studio/sylang
        ├── package.json   tsconfig.json   vite.config.ts   server-entry.js
        ├── Dockerfile     docker-compose.prod.yml
        ├── public/                    # sylang-logo + @sylang/* synced assets
        └── src/
            ├── router.tsx  routeTree.gen.ts  styles.css
            ├── brand.config.ts        # Sylang brand + registers sylang plugins
            ├── features/              # sylang-editor, spec-dash, symbols
            └── routes/
                ├── __root.tsx  index.tsx
                └── api/{sylang,playground}/   # sylang-only API routes
```

### Why each app keeps its own routes/public/vite/server-entry

TanStack Start generates `routeTree.gen.ts` **per app** from that app's `src/routes`,
so the route tree can't live in a shared package. Routes therefore stay in the app as
**thin shells** that import screens/handlers from `@studio/core`. `public/`,
`vite.config.ts`, and `server-entry.js` differ per app (ports, proxies, the sylang
`@sylang/*` asset sync) — keep them per-app but factor shared logic into
`@studio/core/server-runtime`.

---

## Phase 1 — Scaffold workspace + move shared code

**Branch:** `monorepo/phase-1-pnpm-workspace`

### 1.1 Workspace files

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Root `package.json` (scripts only — no app code/deps at root):
```json
{
  "name": "hermes-studio-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev:hermes": "pnpm --filter @studio/hermes dev",
    "dev:sylang": "pnpm --filter @studio/sylang dev",
    "build": "pnpm -r build",
    "build:hermes": "pnpm --filter @studio/hermes... build",
    "build:sylang": "pnpm --filter @studio/sylang... build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "packageManager": "pnpm@9.15.4"
}
```

`tsconfig.base.json` (shared options; today's `tsconfig.json` minus paths):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": false
  }
}
```

### 1.2 studio-core package

`packages/studio-core/package.json`:
```json
{
  "name": "@studio/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./components/*": "./src/components/*",
    "./hooks/*": "./src/hooks/*",
    "./lib/*": "./src/lib/*",
    "./server/*": "./src/server/*",
    "./stores/*": "./src/stores/*",
    "./screens/*": "./src/screens/*",
    "./brand": "./src/brand/index.ts",
    "./plugins": "./src/plugins/index.ts",
    "./server-runtime/*": "./src/server-runtime/*",
    "./styles.css": "./src/styles.css"
  },
  "peerDependencies": {
    "react": "^19", "react-dom": "^19",
    "@tanstack/react-router": "*", "@tanstack/react-start": "*",
    "@tanstack/react-query": "*", "zustand": "*"
  },
  "dependencies": { "...": "the shared runtime deps (lucide-react, clsx, tailwind-merge, @supabase/*, marked, etc.)" }
}
```
> Ship `studio-core` as **source** (no build step). Vite/TanStack in each app
> transpiles it. This keeps iteration fast (no publish/bump). The `exports` map
> mirrors today's `@/*` subfolders so import rewrites are mechanical.

`packages/studio-core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json",
  "compilerOptions": { "baseUrl": "src", "noEmit": true } }
```

### 1.3 Move the shared files (the bulk FS step — do on a stable FS)

Use `git mv` so history follows. Move everything that is **byte-identical** between
the two repos + the agreed Bucket-C-reconciled versions:

```
git mv src/components packages/studio-core/src/components   # minus sylang-editor, spec-dash
git mv src/hooks       packages/studio-core/src/hooks
git mv src/lib         packages/studio-core/src/lib
git mv src/server      packages/studio-core/src/server
git mv src/stores      packages/studio-core/src/stores
git mv src/utils       packages/studio-core/src/utils
git mv src/types       packages/studio-core/src/types
git mv src/styles.css  packages/studio-core/src/styles.css
git mv src/screens     packages/studio-core/src/screens      # generic screens
```
Keep in each app: `routes/`, `router.tsx`, `routeTree.gen.ts`, `brand.config.ts`,
`styles.css` import.

### 1.4 Import rewrite (`@/` → `@studio/core/`)

In files **moved into core**, internal `@/x` imports become **relative** (they're now
co-located) — the cleanest is to drop the alias inside the package and use relative
paths, OR keep `@/*` mapped to `packages/studio-core/src/*` inside core's tsconfig.
In **app** files, `@/components/x` → `@studio/core/components/x`. Mechanical codemod:

```bash
# In app src only: point core subfolders at the package.
npx jscodeshift -t rewrite-imports.ts apps/*/src \
  --from='@/(components|hooks|lib|server|stores|screens)/' \
  --to='@studio/core/$1/'
```
Keep `@/*` in each app's `tsconfig.json` mapped to that app's own `src/*` for
app-local imports (routes, brand.config, features).

### 1.5 Create the two apps

For **each** app, the `vite.config.ts` is today's hermes-studio config with the
project root adjusted. Add `@studio/core` to `ssr.noExternal` and to
`optimizeDeps`/`server.fs.allow` so Vite transpiles the linked workspace package:

```ts
// apps/<app>/vite.config.ts  (excerpt; start from current hermes-studio vite.config.ts)
export default defineConfig({
  // ...tanstackStart(), react(), tailwindcss() as today...
  ssr: { noExternal: ['@studio/core', '@sylang/jot-editor', '@jotx-labs/*'] },
  server: {
    port: APP === 'hermes' ? 3002 : 3000,
    fs: { allow: ['..', '../../packages/studio-core'] },
    proxy: { /* same /ws-hermes, /api/hermes-proxy, /workspace-api rules */ },
  },
})
```
> The hermes-agent + workspace-daemon auto-start logic in the current vite config
> is shared — factor it into `@studio/core/server-runtime/dev-services.ts` and call
> it from both app configs.

Each app's `tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json",
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },
  "references": [{ "path": "../../packages/studio-core" }] }
```

### 1.6 Gate

`pnpm install` at root (links the workspace). Then **both** apps must build:
```
pnpm --filter @studio/hermes... build
pnpm --filter @studio/sylang... build
```
Expect to iterate on `ssr.noExternal` and the `exports` map until clean. **PR only
when both build.**

> Do Phase 0's Bucket-C reconciliation here (or as the commit just before): when a
> moved file differs between repos, commit the **winning** (usually sylang) version
> per `01-phase0-drift-report.md`. Skip v1-chat files (Phase 4 deletes them).

---

## Phase 2 — Brand abstraction

**Branch:** `monorepo/phase-2-brand-config`

`packages/studio-core/src/brand/types.ts`:
```ts
import type { ComponentType } from 'react'
import type { ThemeId } from '../lib/theme'

export interface Brand {
  id: 'hermes' | 'sylang'
  appTitle: string
  legalName: string
  description: string
  logo: string            // path under the app's public/
  iconHref: string        // favicon / crest
  themes: ThemeId[]       // visible in settings
  defaultTheme: ThemeId
  loadingQuips: string[]
  onboarding: OnboardingContent
  plugins: StudioPlugin[] // Phase 3
}
```

`packages/studio-core/src/brand/brand-context.tsx`:
```tsx
import { createContext, useContext } from 'react'
import type { Brand } from './types'
const BrandContext = createContext<Brand | null>(null)
export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}
export function useBrand(): Brand {
  const b = useContext(BrandContext)
  if (!b) throw new Error('useBrand must be used within BrandProvider')
  return b
}
```

`apps/hermes/src/brand.config.ts`:
```ts
import type { Brand } from '@studio/core/brand'
export const brand: Brand = {
  id: 'hermes',
  appTitle: 'Hermes Studio',
  legalName: 'Hermes Studio',
  description: 'Hermes Studio — AI agent workspace with chat, files, terminal, memory, and skills.',
  logo: '/hermes-crest.svg',
  iconHref: '/hermes-crest.svg',
  themes: ['hermes-official', 'hermes-official-light', 'hermes-classic', 'hermes-slate', 'hermes-mono'],
  defaultTheme: 'hermes-official',
  loadingQuips: ['Consulting the oracle...', 'Summoning Hermes...', /* ... */],
  onboarding: HERMES_ONBOARDING,
  plugins: [],
}
```

`apps/sylang/src/brand.config.ts`: same shape with the Sylang values (default
`sylang-studio-light`, logo `/sylang-logo.svg`, MBSE description, parsing quips) and
`plugins: [sylangEditorPlugin, specDashPlugin, playgroundPlugin, symbolCachePlugin]`.

**Wire-up:** core `__root.tsx` wraps the tree in `<BrandProvider brand={brand}>`
(each app passes its own `brand`). Replace the hardcoded title/theme/logo/quips in
`__root.tsx`, `use-page-title.ts`, `login-screen.tsx`, `connection-startup-screen.tsx`
with `useBrand()` reads. The theme-migration script (sylang-only) is gated on
`brand.id === 'sylang'`.

**Gate:** both apps build and show their own title/theme/logo/homepage.

---

## Phase 3 — Plugin registry (extract sylang features)

**Branch:** `monorepo/phase-3-plugin-registry`

`packages/studio-core/src/plugins/editor-registry.ts`:
```ts
import type { ComponentType } from 'react'
export interface EditorPlugin {
  id: string
  match: (filename: string) => boolean
  /** true → the editor does its own file I/O; host won't pre-load content. */
  ownsIO?: boolean
  component: ComponentType<{ path: string; workspacePath: string; focusSymbolId?: string }>
}
const editors: EditorPlugin[] = []
export function registerEditor(p: EditorPlugin) { editors.push(p) }
export function resolveEditor(filename: string) { return editors.find((e) => e.match(filename)) }
```

`packages/studio-core/src/plugins/file-lifecycle.ts`:
```ts
type Handler = (path: string, content?: string) => void | Promise<void>
const hooks = { written: [] as Handler[], moved: [] as Handler[], deleted: [] as Handler[], pulled: [] as Handler[] }
export const fileLifecycle = {
  onWritten: (h: Handler) => hooks.written.push(h),
  onMoved:   (h: Handler) => hooks.moved.push(h),
  onDeleted: (h: Handler) => hooks.deleted.push(h),
  onPulled:  (h: Handler) => hooks.pulled.push(h),
  fire: async (k: keyof typeof hooks, p: string, c?: string) => { for (const h of hooks[k]) await h(p, c) },
}
```
Also `nav-registry.ts` (extra sidebar items), and a `systemPromptContributions`
collector for the agent-prompt additions.

**Refactor core to use the registries:**
- `routes/files.tsx`: replace the hardcoded Sylang/Spec/Dash/Jotx branches with
  `resolveEditor(name)`; default to CodeMirror. The `ownsIO` flag replaces the
  `!isJotxFile && !isSylangFile && ...` content-preload guard.
- `routes/api/files.ts`: replace direct `workspaceSymbolCache` calls with
  `fileLifecycle.fire('written'|'moved'|'deleted'|'pulled', ...)`.
- `routes/api/send-stream.ts`: keep the generic `FILE_MUTATING_TOOLS` detection in
  core; after a mutating tool, call `fileLifecycle.fire('written', ...)`. Move the
  "Sylang and Jot skills" prompt text into a sylang systemPrompt contribution.
- `routes/projects.tsx`: render core tabs + `navRegistry.projectTabs`.

**Move sylang code into `apps/sylang/src/features/`:**
- `sylang-editor/`, `spec-dash/`, `symbols/` (was `src/sylang/symbolManager`).
- `apps/sylang/src/routes/api/sylang/*` and `.../playground/*` (app-local handlers).

**Register in `apps/sylang/src/brand.config.ts`** (runs at app startup):
```ts
registerEditor({ id: 'sylang', match: isSylangFile, ownsIO: true, component: SylangFileEditor })
registerEditor({ id: 'spec',   match: (n) => n.endsWith('.spec'), ownsIO: true, component: SpecViewer })
registerEditor({ id: 'dash',   match: (n) => n.endsWith('.dash'), ownsIO: true, component: DashViewer })
fileLifecycle.onWritten(updateSymbolCache)
fileLifecycle.onMoved(moveSymbolCache)
fileLifecycle.onDeleted(removeFromSymbolCache)
fileLifecycle.onPulled(invalidateWorkspaceSymbols)
navRegistry.addProjectTab(PLAYGROUND_TAB)
```
**CodeMirrorEditor decision:** keep core's inline implementation (default editor).
Sylang may override via its own `registerEditor` if it wants `@sylang/code-editor`.

**Gate:** Hermes builds with **zero** `@sylang/*` / sylang-feature imports; Sylang
builds with the editors/symbol-cache/playground working through the registries.

---

## Phase 4 — Promote chat-v2 to core; deprecate v1

**Branch:** `monorepo/phase-4-chat-v2`

1. Move `screens/chat-v2/` → `packages/studio-core/src/screens/chat-v2/` (already
   self-contained: 7 files — `chat-screen-v2.tsx`, `runtime/{use-sylang-chat,sse-client,local-sessions}`,
   `components/{sessions-sidebar,tool-section}`, `hooks/use-history-hydration`).
2. **Parity audit (do before deleting v1):** confirm chat-v2 covers each v1 capability:

   | v1 capability | in v2? |
   |---|---|
   | streaming assistant messages (SSE) | ✅ `use-sylang-chat` |
   | reasoning / tool-call parts rendering | ✅ `tool-section` |
   | attachments (images/files) | ☐ verify |
   | session list create/delete/rename | ☐ verify `sessions-sidebar` |
   | history hydration on load | ✅ `use-history-hydration` |
   | abort / stop generation | ☐ verify |
   | context meter / usage | ☐ verify (v1 has `context-bar`/`context-meter`) |
   | mobile layout | ☐ verify |
   | message actions (copy/retry) | ☐ verify |
   | pinned/realtime session updates | ☐ verify |

   Fill the ☐ rows by diffing v1 features against v2; port any genuine gaps into
   chat-v2 **before** removing v1.
3. Point both apps' chat route at chat-v2: `routes/chat/$sessionKey.tsx` →
   `ChatScreenV2`. Remove the `/chat-v2/$sessionKey` parallel route (v2 becomes the
   only chat).
4. Delete v1: `screens/chat/` (the ~12 drifted v1 files in the report become moot),
   v1-only store paths in `chat-store.ts` if unused by v2, `chat-event-bus`/
   `chat-backends` only if v2 doesn't use them (verify — v2 uses `/api/send-stream`).
5. **Gate:** both apps build; chat works end-to-end via chat-v2 in each.

---

## Phase 5 — Two Dockerfiles, independent deploy

**Branch:** `monorepo/phase-5-docker`

Per-app Dockerfile. **Build context = repo root** (needs the workspace lockfile +
`packages/studio-core`); `--filter` to the one app. `apps/sylang/Dockerfile`:

```dockerfile
# Build:  docker build -f apps/sylang/Dockerfile -t sylang-studio-web .   (from repo root)
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# manifests first for cached installs
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
`apps/hermes/Dockerfile` is identical with `@studio/hermes`.

Each app's `docker-compose.prod.yml` (today's hermes-studio compose, two changes):
```yaml
services:
  web:
    build:
      context: ../..                       # repo root
      dockerfile: apps/sylang/Dockerfile    # or apps/hermes/Dockerfile
    image: sylang-studio-web:latest
    # ...rest identical: env_file, volumes, healthcheck /api/ping, caddy...
```
> Sylang already has a production deploy (systemd VPS, `/root/deploy-sylang.sh`,
> at-rest secret encryption). Point that deploy at `apps/sylang`; keep Hermes's on
> `apps/hermes`. They deploy to **separate hosts**, fully independent.

**Gate:** `docker build` succeeds for both apps from a clean checkout; each container
serves on :3000 and passes `/api/ping`.

---

## Merge order

```
phase-1-pnpm-workspace   →  phase-2-brand-config  →  phase-3-plugin-registry
   →  phase-4-chat-v2  →  phase-5-docker
```
Each PR stacked on the previous. Merge in order; never merge a phase whose app(s)
don't build. Phase 0 reconciliation rides inside Phase 1 (or as its lead commit).

## Risks & watch-items

- **TanStack Start + linked workspace package**: the main iteration cost is
  `ssr.noExternal` / `optimizeDeps` until Vite transpiles `@studio/core` cleanly in
  both SSR and client. Budget time here in Phase 1.
- **`@sylang/*` packages** (`jot-editor`, `code-editor`, web-editor/diagrams/fmea
  npm syncs): keep these as **sylang-app deps only**. Hermes must not pull them.
- **Single lockfile**: after scaffolding, regenerate `pnpm-lock.yaml` once at root;
  delete the per-repo lockfiles.
- **Don't reconcile v1-chat files** — Phase 4 deletes them.
- **User WIP**: a `feat/workspace-chat-polish` branch had uncommitted server-side
  work (`agent-sessions.ts`, `openai-compat-api.ts`, `supabase-auth.ts`,
  `secret-crypto.ts`, etc.). Land or rebase that **before** Phase 1's big move, or
  it will conflict with the file relocation.
