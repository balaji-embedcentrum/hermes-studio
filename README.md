# Hermes Studio

**An AI agent workspace with chat, files, terminal, memory, and skills.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

Sign in with GitHub, open any repository, and collaborate with your agent —
it reads, creates, and modifies files in place while you watch the stream.

## Features

- **AI agent chat** — real-time SSE streaming with tool-call visibility
- **CodeMirror 6 editor** — syntax highlighting for 20+ languages
- **Jotx rich-note editor** for structured `.jot` notes
- **Terminal** via xterm, wired to the workspace shell
- **GitHub-native workspaces** — clone any repo, edit, commit from the UI
- **Memory & Skills browser** to shape agent behavior
- **Supabase auth** (GitHub OAuth) with per-user workspace isolation
- **Real-time session updates** via Supabase realtime
- **MCP + multi-provider backends** — any OpenAI-compatible gateway

## Quick start (local dev)

```bash
pnpm install

cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
# ANTHROPIC_API_KEY, HERMES_API_URL, HERMES_API_TOKEN

pnpm dev
# → http://localhost:3000
```

## Deployment

Production topology is split across two hosts:

- **Web tier**: this app (Node SSR + Caddy), on a Hostinger VPS
- **Agent tier**: OpenAI-compatible Python gateway, on OVH
- **Edge**: Cloudflare (DNS + TLS proxy)
- **Data**: Supabase cloud (auth, DB, realtime)

See [`docker-compose.yml`](docker-compose.yml).

### Required env vars

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key (browser) |
| `SUPABASE_SERVICE_KEY` | Supabase service role (server-only — never bundled) |
| `ANTHROPIC_API_KEY` | For the agent tier |
| `HERMES_API_URL` | Agent gateway URL |
| `HERMES_API_TOKEN` | Bearer token authenticating web → agent |
| `HERMES_WORKSPACE_DIR` | Persistent volume for per-user repos |

## Security

All API routes require a valid Supabase JWT. Session tokens are stored in
HttpOnly cookies set by the server; there is no client-side token exposure.
Filesystem APIs are scoped to a workspace root with no path-traversal escape.
See `src/server/auth-middleware.ts` and `src/server/supabase-auth.ts`.

## Acknowledgments

The initial shell of this project — chat UI, file explorer scaffolding,
terminal wiring, and the 8-theme system — started from
[Hermes Workspace](https://github.com/outsourc-e/hermes-agent) by
[Eric (outsourc-e)](https://github.com/outsourc-e), MIT-licensed. Thanks Eric.

Hermes Studio's own direction: Supabase auth and
per-user workspace isolation, real-time sessions and agent registry,
multi-provider backend support, and a rewritten security model.
See [CREDITS.md](CREDITS.md) for detail.

## License

MIT. See [LICENSE](LICENSE).

## Author

Balaji Boominathan ([@balaji-embedcentrum](https://github.com/balaji-embedcentrum))
