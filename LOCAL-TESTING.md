# Local Testing — both brands from one engine

This folder is **studio-core** (the engine). It's one codebase; the brand is chosen
at build/run time by `VITE_BRAND` (`hermes` | `sylang`, default `sylang`).
`.env` is already copied in (your Sylang secrets; gitignored, never pushed).

Status going in: **build verified for both brands** (hermes ✓, sylang ✓), and the
**sylang build runtime-verified** here (serves `<title>Sylang Studio</title>`, MBSE
description, `/sylang-logo.svg`). This guide is for you to confirm both on localhost.

## ⚠️ Two gotchas (read first)

1. **Build with `.env` present.** The Supabase URL/anon-key are baked into the
   **client** bundle at *build* time (vite `loadEnv` reads `.env`). If you build
   without `.env` in the folder, the browser shows *"@supabase/ssr: Your project's
   URL and API key are required"*. `.env` is already here — just don't build without it.
2. **First `pnpm dev` is slow & silent.** `vite dev` pre-bundles a big dep graph
   (`@sylang/*`, mermaid, CodeMirror) on first run — it can sit **1–3 min with no
   output** before `Local: http://localhost:3000`. That's not a hang; it caches
   after the first run. If you don't want to wait, use Option 2 (build + serve).
3. **Never `vite build` with `NODE_ENV=development`.** If `.env` pins
   `NODE_ENV=development`, the *production* build emits React's dev JSX runtime
   (`jsxDEV`), the browser throws `jsxDEV is not a function`, React never hydrates,
   and **nothing is clickable**. The `build:*` and `serve` scripts now force
   `NODE_ENV=production`, and `NODE_ENV` was removed from this local `.env`. (Docker
   already sets `NODE_ENV=production`, which is why prod deploys never hit this.)

## Option 1 — dev mode, one brand at a time

Dev mode auto-loads `.env`. Both run on :3000 (your Supabase callback) — one at a time.

```bash
# Sylang Studio  → http://localhost:3000   (wait through first-run optimize)
pnpm dev:sylang

# (stop it, then) Hermes Studio → http://localhost:3000
pnpm dev:hermes
```

> Note: with no `HERMES_API_URL` in `.env`, dev tries to start the local Python
> `hermes-agent` on :8642. For **brand/UI** verification you don't need it — the
> gateway will just show "disconnected", which is fine. For full chat/agent
> functionality, set `HERMES_API_URL` in `.env` to your running agent, or start
> `hermes-agent` as a sibling.

## Option 2 — build + serve (most reliable; recommended)

One brand at a time on :3000. `.env` must be present for the build (gotcha #1),
and exported for the serve.

```bash
# Sylang
pnpm build:sylang
set -a; . ./.env; set +a; PORT=3000 pnpm serve   # → http://localhost:3000

# stop it (Ctrl-C), then Hermes
pnpm build:hermes
set -a; . ./.env; set +a; PORT=3000 pnpm serve   # → http://localhost:3000
```

> `pnpm serve` (= `node server-entry.js`) does **not** auto-load `.env`. Export it
> first if you want the API routes live:
> `set -a; . ./.env; set +a; PORT=3000 pnpm serve`

## What to verify — the four brand differences

| # | Difference | Sylang (`:3000`) | Hermes (`:3001`) |
|---|---|---|---|
| 1 | **Identity** | "Sylang Studio" title, sylang logo, `sylang-studio-light` default theme | "Hermes Studio" title, hermes crest, `hermes-official` default theme |
| 2 | **MBSE tools** | Coverage / Traceability / FMEA quick-actions on the workspace home | **absent** (clean home) |
| 3 | **Workspace home** | MBSE quick-actions + Sylang file-type guide + standards callout | minimal home (no MBSE sections) |
| 4 | **Landing** (`/`) | "Sylang Studio" sign-in | "Hermes Studio" sign-in |

Everything else (chat-v2, Sylang editor, spec-dash, `/api/sylang`, jotx, terminal,
files, etc.) is identical and present in **both**.

## Nothing is pushed

No GitHub pushes happen until you've tested both and agreed. The intended repo
mapping (after you're happy): this engine → **hermes-studio** (as `studio-core`);
deploy wrappers → **hermes-apps** (scaffolded in a sibling folder).
