# Credits

Hermes Studio is built on top of **Hermes Workspace** by Eric (outsourc-e).

## Upstream project

- **Name**: Hermes Workspace
- **Author**: Eric ([@outsourc-e](https://github.com/outsourc-e))
- **Repository**: https://github.com/outsourc-e/hermes-agent
- **License**: MIT

Eric's original Hermes Workspace provided the entire foundation this project
is built on:

- The TanStack Start + Vite + React 19 architecture
- Chat UI with SSE streaming and tool-call rendering
- File explorer and terminal integration (xterm)
- Memory and skills browser
- The 8-theme system and PWA packaging
- The Python Hermes agent gateway (runtime dependency, not forked)

## Changes in Hermes Studio

This fork generalizes the workspace for broader use:

- Removed domain-specific Sylang MBSE features (DSL editors, traceability,
  FMEA, spec/dash viewers) — those live in a separate package that may be
  integrated later as an npm dependency.
- Supabase authentication and per-user workspace isolation.
- Real-time session updates via Supabase realtime.
- Rebranded UI and landing page.
- Targeted for single-VPS deployment with Caddy/Cloudflare in front.

## Runtime dependency

Hermes Studio runs against the **Hermes Agent** (Python FastAPI gateway),
which is also Eric's project and is pulled from `outsourc-e/hermes-agent`
at build time. It is not forked or modified here.

## License

MIT. Eric's original copyright is preserved in [LICENSE](LICENSE). Derivative
work copyright is attributed to the Hermes Studio contributors.
