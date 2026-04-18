# Credits

## Initial scaffold

The initial scaffold started from [Hermes Workspace](https://github.com/outsourc-e/hermes-agent)
by Eric ([@outsourc-e](https://github.com/outsourc-e)), MIT-licensed. The pieces
that carried over and helped us skip reinventing:

- TanStack Start + Vite + React 19 project layout
- Chat UI shell with SSE streaming and tool-call rendering
- File explorer component
- xterm terminal integration
- Memory and skills browsers
- Eight-theme light/dark system

Thanks Eric.

## Hermes Studio additions

Everything after the initial scaffold is Hermes Studio's own work:

- **Supabase auth** with GitHub OAuth (manual PKCE flow to work around
  TanStack Start SSR quirks), server-set HttpOnly session cookies, profile
  provisioning with per-user Linux UIDs
- **Per-user workspace isolation** — symlink-activated workspace mounts,
  filesystem boundary enforcement
- **Agent registry via Supabase** — `agent_instances` table, per-session
  agent assignment, cooldown/locking, real-time status updates
- **Agent session lifecycle** — start/end/expiry with real-time UI
  updates, idle detection, cleanup on logout
- **Multi-provider backend** — OpenAI-compatible gateway model,
  bring-your-own-LLM support, provider catalog
- **Security rewrite** — removed the legacy HERMES_PASSWORD bypass and
  X-Forwarded-For trust, unified every API route behind Supabase JWT,
  hardened path-traversal handling, HttpOnly cookies, auth-scoped SSE

## Runtime dependency

Hermes Studio uses the **Hermes Agent** Python FastAPI gateway from
[outsourc-e/hermes-agent](https://github.com/outsourc-e/hermes-agent) as
a runtime dependency. It is not forked or modified here — it is pulled
from upstream at build time.

## License

MIT. Both Eric's original copyright and the Hermes Studio copyright are
preserved in [LICENSE](LICENSE).
