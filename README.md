# Hermes Studio

A self-hostable, browser-based **AI agent workspace** — chat, a file tree, an
integrated terminal, memory/skills, and per-user GitHub workspaces — built on
[TanStack Start](https://tanstack.com/start) (React 19 SSR) + Vite + Tailwind,
with [Supabase](https://supabase.com) for auth and data.

This repository is the **`studio-core` engine**. It is *brand-parameterized*:
the same code ships as two products, chosen at build time by `VITE_BRAND` —

| `VITE_BRAND` | Product | Adds |
|---|---|---|
| `hermes` | **Hermes Studio** | the agent IDE base (chat, files, terminal, memory, skills) |
| `sylang` *(default)* | **Sylang Studio** | everything above **+** the Sylang MBSE toolset (Coverage / Traceability / FMEA, DSL & diagram editors) |

Everything else is identical between the two. The public marketing/landing
sites are **separate** repositories ([`hermes-marketing`](https://github.com/balaji-embedcentrum/hermes-marketing),
[`sylang-visual-forge`](https://github.com/balaji-embedcentrum/sylang-visual-forge));
`/` in *this* repo is a minimal sign-in gateway, not a marketing page.

> **License:** MIT · **Node:** ≥ 22 · **Package manager:** pnpm 9

---

## Quick start

```bash
# 1. Install (postinstall copies the Sylang editor bundles into public/)
pnpm install

# 2. Configure
cp .env.example .env
#    → fill SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY
#      and HERMES_API_URL (your agent gateway). See "Configuration" below.

# 3. Run a brand in dev (http://localhost:3000)
pnpm dev:hermes      # or: pnpm dev:sylang

# 4. Production build + serve
pnpm build:hermes    # or: pnpm build:sylang
pnpm serve           # runs server-entry.js (Node SSR) on $PORT (default 3000)
```

You also need:
- A **Supabase project** (auth + Postgres). Create the tables in
  [Data model](#data-model) and a **GitHub OAuth provider** in Supabase Auth.
- An **agent gateway** — any OpenAI-compatible backend (the Hermes agent,
  LiteLLM, etc.) reachable at `HERMES_API_URL`. Without it the UI loads but
  chat has nothing to talk to.

---

## Configuration

All config is environment variables (`.env`, gitignored). Only the two public
Supabase values are baked into the browser bundle; everything else is
server-only. Full annotated list is in [`.env.example`](.env.example).

| Variable | Scope | Purpose |
|---|---|---|
| `SUPABASE_URL` | public (baked) | Supabase project URL |
| `SUPABASE_ANON_KEY` | public (baked) | Anon key — **RLS-protected**, safe in the client |
| `SUPABASE_SERVICE_KEY` | server only | Service role — **bypasses RLS**, never ship to the browser |
| `SECRETS_ENCRYPTION_KEY` | server only | AES-256-GCM key for secrets at rest (see [Security](#security)). `openssl rand -base64 32`. **Back it up offline.** |
| `HERMES_API_URL` | server | Default agent gateway URL (per-user agents override this — see [Data model](#data-model)) |
| `HERMES_API_TOKEN` | server only | Bearer token for the *local-default* agent only; per-user agents use their own key |
| `HERMES_WORKSPACE_DIR` | server | Where per-user GitHub clones live (default `/workspace`) |

> ⚠️ Server-only variables **must not** carry a `VITE_` prefix — anything
> `VITE_*` is exposed to the browser bundle by Vite.

---

## Branding — make your own studio

A "brand" is the only thing that differs between Hermes and Sylang. To add a
third (say, `acme`):

**1. Define the brand** in [`src/brand/configs.ts`](src/brand/configs.ts):

```ts
export const acmeBrand: Brand = {
  id: 'acme',
  appTitle: 'Acme Studio',
  description: 'Acme Studio — …',
  logo: '/acme-logo.svg',          // drop the file in public/
  loadingTagline: 'Your tagline',
  loadingQuips: ['Booting…', 'Almost there…'],
  themes: ['acme-dark', 'acme-light'],   // must exist in src/styles.css @theme
  defaultTheme: 'acme-dark',
  showMbseTools: false,            // true → surface Coverage/Traceability/FMEA
}
```

**2. Wire it up** in [`src/brand/index.ts`](src/brand/index.ts) so
`VITE_BRAND=acme` resolves to `acmeBrand`, and add `'acme'` to the `Brand['id']`
union in [`src/brand/types.ts`](src/brand/types.ts).

**3. Register the themes** as `@theme` blocks in `src/styles.css` (Tailwind 4
only generates utilities for colors declared there) and add your logo to
`public/`.

The [`Brand`](src/brand/types.ts) interface is the contract — there are exactly
**four** seams, and nothing else changes:

1. **Identity** — title, description, logo, themes, loading text (above).
2. **`showMbseTools`** — whether the MBSE tools are surfaced.
3. **Workspace home** — the in-editor home view (resolved by `brand.id` in the
   files route).
4. **Landing** — the public sign-in page at `/` (resolved by `brand.id` in
   [`src/routes/index.tsx`](src/routes/index.tsx)).

Build it with `VITE_BRAND=acme pnpm build` (or add `build:acme` to
`package.json`). For a **public marketing site**, create a separate static app
(see `hermes-marketing` as a template) — keep heavy marketing out of this repo;
its `/` route is only a sign-in gateway + OAuth-error surface.

---

## Architecture

```
Browser ──▶ TanStack Start SSR (server-entry.js, plain node:http)
              ├─ /             sign-in gateway (brand landing)
              ├─ /files…       the editor / workspace UI
              └─ /api/*        server route handlers:
                    ├─ auth/github, auth/callback   GitHub OAuth (manual PKCE)
                    ├─ send-stream, events          agent chat (SSE streaming)
                    ├─ terminal-stream              PTY over SSE
                    └─ workspaces/clone             per-user GitHub clone
                          │
                          ▼
                    Agent gateway (OpenAI-compatible)  ← HERMES_API_URL / per-user key
```

- **SSR server** — `server-entry.js` is a plain `node:http` server that serves
  the built client + runs the route handlers. No compression middleware (SSE
  streams must stay unbuffered).
- **Auth** — GitHub OAuth via Supabase, with a *manual* PKCE flow: the
  `code_verifier` is generated server-side and stored in an **HttpOnly cookie**
  (`src/routes/api/auth/github.ts`), so the code-for-session exchange happens
  server-side in `auth/callback`.
- **Streaming** — agent chat and the terminal stream over SSE. All SSE routes
  send `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` so
  intermediaries (e.g. a CDN/tunnel) don't compress/buffer the stream.
- **Editor bundles** — the Sylang editors (`@sylang/web-editor`,
  `web-diagrams`, `fmea-view`) are copied from `node_modules` into `public/`
  by `pnpm sync:editors` (runs automatically on `postinstall`/`prebuild`).

---

## Data model

Postgres (via Supabase). The browser uses the **anon key and is fully
constrained by Row-Level Security**; server route handlers use the service key
for admin operations. TypeScript shapes live in
[`src/lib/supabase.ts`](src/lib/supabase.ts).

### `profiles` — one row per user (keyed to `auth.users.id`)
| Column | Notes |
|---|---|
| `id` | UUID, = `auth.users.id` |
| `github_login`, `email` | from the GitHub OAuth identity |
| `system_uid` | per-user Linux UID for workspace isolation |
| `credits`, `tier` | usage accounting (`free` / `pro` / `byollm` / `sylang_llm`) |
| `push_enabled` | web-push opt-in |

### `agent_instances` — the agent registry / fleet
| Column | Notes |
|---|---|
| `persona_name`, `specialist_type` | display + role (`requirements`/`architect`/`safety`/`verification`/`custom`) |
| `api_url`, `model_name` | where this agent lives + which model it reports |
| `api_key` | **encrypted at rest** (`enc:v1:` envelope) — never plaintext |
| `owner_user_id` | null = shared fleet agent; set = user-owned |
| `deployment_type` | `cloud_fleet` / `user_vps` / `user_tunnel` |
| `status`, `current_session` | scheduling state |

A user's agent (and its key) is looked up here per request; the global
`HERMES_API_TOKEN` is only used for the local-default agent.

### `workspaces` — per-user GitHub clones
`user_id`, `repo_full`, `repo_url`, `fs_path` (on-disk path under
`HERMES_WORKSPACE_DIR`), `size_mb`, `last_accessed`.

### `sessions` — an agent working session
`user_id`, `workspace_id`, `agent_id`, `status`
(`active`/`ended`/`timed_out`/`crashed`), `credits_charged`,
`tokens_in`/`tokens_out`, `started_at`/`ends_at`/`ended_at`.

---

## Security

- **RLS is the boundary.** The anon key is public (it's baked into the client
  bundle). Every table **must** have Row-Level Security enabled with policies
  scoping rows to `auth.uid()`. The service key bypasses RLS and is used only in
  server route handlers — keep it server-side.
- **Secrets at rest.** `agent_instances.api_key` and the stored GitHub token are
  AES-256-GCM encrypted (`enc:v1:` envelope) using `SECRETS_ENCRYPTION_KEY`
  (separate from the Supabase keys). See `src/server/secret-crypto.ts`. Losing
  the key makes those rows unrecoverable — keep an offline backup. Backfill with
  `pnpm migrate:encrypt-secrets`.
- **No secrets in the bundle.** Only `SUPABASE_URL` + `SUPABASE_ANON_KEY` are
  baked in. `HERMES_API_TOKEN` and the service key are explicitly never sent to
  the client.

---

## Deployment

Production runs as a hardened Docker image behind a **Cloudflare Tunnel** (no
inbound ports). The build + compose live in the
[`hermes-apps`](https://github.com/balaji-embedcentrum/hermes-apps) repo, which
builds this image with `VITE_BRAND` per brand and serves it via `cloudflared`.
The `Dockerfile` here is the multi-stage build (pnpm 9 install → `pnpm build` →
slim `node:22-alpine` runner running `server-entry.js`).

---

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev:hermes` / `dev:sylang` | dev server for a brand on `:3000` |
| `pnpm build:hermes` / `build:sylang` | production build for a brand |
| `pnpm serve` | run the built SSR server (`server-entry.js`) |
| `pnpm sync:editors` | copy the Sylang editor bundles into `public/` |
| `pnpm migrate:encrypt-secrets` | one-time backfill to encrypt existing secrets |
| `pnpm check` | `prettier --write` + `eslint --fix` |
| `pnpm test` | vitest |

---

## License

MIT — see [LICENSE](LICENSE).
