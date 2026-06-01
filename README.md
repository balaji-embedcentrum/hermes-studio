# Sylang Studio

**The "Sylang Playground" — a browser IDE for Model-Based Systems Engineering. Sylang DSL, AIAG/VDA FMEA, traceability, and an AI agent that understands every file in your project.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

> Marketing / public landing page lives in
> [sylang-visual-forge](https://github.com/balaji-embedcentrum/sylang-visual-forge).
> The "Sylang Playground" button there links to `GET /api/auth/github` here,
> which kicks off GitHub OAuth via Supabase and lands authenticated users
> in the editor. `/` in this repo is a minimal sign-in gateway, not a
> marketing surface.

Sign in with GitHub, open any Sylang project, and edit `.req`, `.fun`, `.blk`,
`.fml`, `.vml`, `.flr`, `.fta`, `.haz`, `.tst`, `.ifc`, `.smd`, `.ucd`, `.spec`,
`.dash`, and 10+ other first-class file types in dedicated editors —
side-by-side with an AI agent that can read, modify, and refactor them.

## Features

### Sylang MBSE workbench
- **Block-aware editor** for `.req`, `.fun`, `.blk`, `.fml`, `.vml`, `.fta`,
  `.haz`, `.ifc`, `.smd`, `.ucd` and more — TipTap rendering of the parsed
  DSL, not just plain text.
- **Diagram editors** for internal-block, feature-model, variant-model,
  fault-tree, sequence, state-machine, use-case (D3/Konva/Sigma based).
- **Spec + Dash views** — `.spec` and `.dash` files render with embedded
  cross-file diagrams and live data.
- **FMEA AIAG/VDA workbench** — full 7-step failure-modes UI (Structure →
  Function → Failure → Risk → Optimization → Results) backed by a shared
  symbol manager.
- **Coverage Report** — 5-state symbol classification (isolated / orphan /
  sink / connected / broken) with per-edge `source —rel→ target` detail.
- **Traceability Graph** — interactive D3/Sigma graph of every symbol +
  every relationship in the workspace, with click-to-inspect side panel.
- **Variant matrix** — VML feature toggling, VCF generation, 150% PLE model.

### Agent IDE base (inherited from Hermes Studio)
- **AI agent chat** — real-time SSE streaming with tool-call visibility
- **CodeMirror 6 editor** for non-Sylang text files, 20+ languages
- **Jotx rich-note editor** for structured `.jot` notes
- **Terminal** via xterm, wired to the workspace shell
- **GitHub-native workspaces** — clone any repo, edit, commit, push from the UI
- **Memory & Skills browser** to shape agent behavior
- **Supabase auth** (GitHub OAuth) with per-user workspace isolation
- **MCP + multi-provider backends** — any OpenAI-compatible gateway

## Architecture

```
sylang-studio (this repo)
  └── src/                  ← TanStack Start / React 19 / Vite
      ├── routes/           ← API + page routes
      ├── components/
      │   └── sylang-editor/  ← Inline FMEA/Coverage/Traceability views
      └── sylang/           ← Server-side symbol cache + transformers

@sylang-core (sibling monorepo at ../sylang-core)
  ├── packages/core           ← Symbol manager, parser, types
  ├── packages/web-editor     ← Per-file Sylang DSL editor (iframe bundle)
  ├── packages/web-diagrams   ← Diagram renderers (iframe + library entry)
  ├── packages/fmea-view      ← AIAG/VDA FMEA workbench (iframe bundle)
  ├── packages/spec-dash      ← .spec / .dash renderers
  ├── packages/traceability   ← Matrix builder + coverage analysis
  ├── packages/variant-matrix ← VML feature toggling
  ├── packages/code-editor    ← Headless tsup library
  └── packages/registry       ← File-type → renderer mapping
```

Each `@sylang/*` package is consumed via `link:../sylang/packages/*`
in `package.json` for fast local iteration. Production builds the static
iframe bundles into `public/sylang-{editor,diagrams,fmea}/` via the
`sync:editor:*` scripts.

## Quick start (local dev)

```bash
# Clone the sylang-core monorepo as a SIBLING directory:
#   ~/Documents/sylang-core/
#   ~/Documents/sylang-studio/   ← this repo
git clone https://github.com/balaji-embedcentrum/sylang-core.git ../sylang-core
( cd ../sylang-core && pnpm install && pnpm -r build )

# Then this repo:
pnpm install

cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
# ANTHROPIC_API_KEY, HERMES_API_URL, HERMES_API_TOKEN
# All other vars in .env.example are optional with sensible defaults.

pnpm dev
# → http://localhost:3000
```

### Sync the iframe bundles after editing @sylang-core sources

```bash
pnpm sync:editor:sylang     # @sylang/web-editor → public/sylang-editor/
pnpm sync:editor:diagrams   # @sylang/web-diagrams → public/sylang-diagrams/
pnpm sync:editor:fmea       # @sylang/fmea-view → public/sylang-fmea/
pnpm sync:editors           # all three at once
```

## Required env vars

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key (browser) |
| `SUPABASE_SERVICE_KEY` | Supabase service role (server-only — never bundled) |
| `ANTHROPIC_API_KEY` | For the agent tier |
| `HERMES_API_URL` | Agent gateway URL |
| `HERMES_API_TOKEN` | Bearer token authenticating web → agent |
| `HERMES_WORKSPACE_DIR` | Persistent volume for per-user repos |

See [`.env.example`](.env.example) for ~10 additional optional knobs
(workspace paths, telemetry, model defaults, dev-only LAN access).

## Relationship to Hermes Studio

This project is a fork of [Hermes Studio](https://github.com/balaji-embedcentrum/hermes-studio)
— the agent-IDE base. All Sylang-specific features (DSL editors, diagrams,
FMEA, traceability, coverage, file-type registry) are layered on top.

If you want only the agent IDE without the MBSE features, use Hermes Studio
directly. If you do systems engineering and want both the agent and the
Sylang tooling, this is the right repo.

## Deployment

Production topology is split across two hosts (same as Hermes Studio):

- **Web tier** — this app (Node SSR + Caddy), on a VPS
- **Agent tier** — OpenAI-compatible Python gateway
- **Edge** — Cloudflare (DNS + TLS proxy)
- **Data** — Supabase cloud (auth, DB, realtime)

See [`docker-compose.yml`](docker-compose.yml).

## Security

All API routes require a valid Supabase JWT. Session tokens are stored in
HttpOnly cookies set by the server; there is no client-side token exposure.
Filesystem APIs are scoped to a workspace root with no path-traversal escape.
See `src/server/auth-middleware.ts` and `src/server/supabase-auth.ts`.

## Acknowledgments

The agent-IDE shell — chat UI, file explorer scaffolding, terminal wiring,
the 8-theme system — comes from
[Hermes Workspace](https://github.com/outsourc-e/hermes-agent) by
[Eric (outsourc-e)](https://github.com/outsourc-e), MIT-licensed. Thanks Eric.

The Sylang DSL + every `@sylang/*` package, the FMEA workbench,
traceability/coverage analysis, and the MBSE-specific editors are
developed alongside this repo. See [CREDITS.md](CREDITS.md) for detail.

## License

MIT. See [LICENSE](LICENSE).

## Author

Balaji Boominathan ([@balaji-embedcentrum](https://github.com/balaji-embedcentrum))
