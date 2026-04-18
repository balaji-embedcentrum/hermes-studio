# Hermes Studio

**AI agent workspace — chat, files, terminal, memory, and skills in one browser IDE.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

Hermes Studio is a browser-based workspace for working with AI coding agents.
Sign in with GitHub, open any repository, and collaborate with the agent — it
reads, creates, and modifies files in place while you watch the stream.

## Acknowledgments

Hermes Studio is a rebrand and generalization of [**Hermes Workspace**](https://github.com/outsourc-e/hermes-agent)
by [Eric (outsourc-e)](https://github.com/outsourc-e). The original project provided the
chat, files, terminal, memory, and skills architecture — all credit to Eric for
the foundation. See [CREDITS.md](CREDITS.md) for details. MIT license preserved.

## Features

- **AI agent chat** with real-time SSE streaming and tool-call visibility
- **CodeMirror 6 editor** with syntax highlighting for 20+ languages
- **Jotx rich-note editor** for structured `.jot` notes
- **Terminal** via xterm, wired to the workspace shell
- **GitHub-native workspaces** — clone any repo, edit in place, commit from the UI
- **Memory & Skills browser** for shaping agent behavior
- **Supabase auth** (GitHub OAuth) with per-user workspace isolation
- **Real-time session updates** via Supabase realtime

## Quick start (local dev)

```bash
# 1. Install Node 22+ and pnpm
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

# 3. Run
pnpm dev
# → http://localhost:3000
```

A local Hermes agent (Python FastAPI) is auto-started in dev mode if a sibling
`hermes-agent/` checkout exists. Alternatively, point `HERMES_API_URL` at a
remote gateway.

## Deployment

See [`docker-compose.yml`](docker-compose.yml) for the production topology. The
recommended setup is single-VPS (Contabo or similar) with:

- **Web**: this app on port 3000 (Node SSR)
- **Agent**: `outsourc-e/hermes-agent` on port 8642 (Python FastAPI)
- **TLS**: Caddy or Cloudflare reverse-proxy
- **Auth/DB**: Supabase (external, free tier fine)

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role (server-only) |
| `ANTHROPIC_API_KEY` | For the Hermes agent |
| `HERMES_API_URL` | URL where the agent is reachable |
| `HERMES_API_TOKEN` | Bearer token between web and agent |
| `HERMES_WORKSPACE_DIR` | Persistent volume path for user repos |

## License

MIT. See [LICENSE](LICENSE).

## Author

Balaji Boominathan ([@balaji-embedcentrum](https://github.com/balaji-embedcentrum))
