# Credits

## Starting point

This project was originally bootstrapped from [Hermes Workspace](https://github.com/outsourc-e/hermes-agent)
by Eric ([@outsourc-e](https://github.com/outsourc-e)), MIT-licensed — his
copyright is preserved in [LICENSE](LICENSE). The codebase has since been built
out into its own thing: the current chat, editors, terminal, file tree,
theming, auth, agent integration and tooling are this project's own work, built
on the open-source libraries credited below. Thanks Eric for the starting point.

## What this became

What started as a single agent IDE is now **`studio-core`** — one
brand-parameterized engine that ships as multiple products from the same code
(`VITE_BRAND`): **Hermes Studio** (the agent workspace) and **Sylang Studio**
(the same, plus a Model-Based Systems Engineering toolset), with a `sample`
reference brand to copy. See the README for the brand system.

Work built on top of the scaffold:

- **Brand engine** — one codebase, multiple brands (identity, themes, surfaced
  tools, landing) selected at build time.
- **Supabase auth** — GitHub OAuth via a manual PKCE flow (SSR-friendly),
  HttpOnly session cookies, profile provisioning with per-user Linux UIDs.
- **Per-user workspace isolation** — per-user clones, filesystem boundary
  enforcement, path-traversal hardening.
- **Agent registry + sessions** — `agent_instances` / `sessions` in Supabase,
  per-session assignment, locking/cooldown, real-time status, and the
  start/end/expiry/idle/cleanup lifecycle.
- **Multi-provider backend** — OpenAI-compatible gateway model, bring-your-own
  LLM, per-user agent keys.
- **Secrets encryption** — AES-256-GCM for agent keys (at rest), and the user's
  GitHub token (encrypted inside the session cookie, never persisted, deleted
  when the session ends).
- **Sylang MBSE workbench** — the Sylang brand adds DSL editors, diagram
  editors, FMEA (AIAG/VDA), and coverage + traceability views.
- **Hardened deployment** — a multi-stage Docker image behind a Cloudflare
  Tunnel (no inbound ports), non-root and cap-dropped containers.

## Built on

This project stands on a lot of open source. The major pieces:

- **[TanStack](https://tanstack.com)** — Start, Router, Query (SSR app, routing, data layer)
- **React 19**, **Vite**, **Tailwind CSS**
- **[Supabase](https://supabase.com)** — `@supabase/ssr`, `@supabase/supabase-js` (auth, Postgres, realtime)
- **xterm.js** — the integrated terminal
- **D3**, **lucide** icons, **Zod**, **Zustand**, **react-markdown**, **react-joyride**
- The **Sylang** packages (`@sylang/*`) — the MBSE DSL, editors, diagrams, FMEA,
  traceability and variant tooling behind Sylang Studio
- The **jotx** editor framework (`@jotx-labs/*`, TipTap-based) — structured
  document editing

## Runtime dependency

The studios talk to the **Hermes Agent** Python/FastAPI gateway from
[outsourc-e/hermes-agent](https://github.com/outsourc-e/hermes-agent) as a
runtime dependency — the agent compute lives there. It is pulled from upstream,
not forked or modified here.

## License

MIT. Eric's original copyright and the project's copyright are both preserved in
[LICENSE](LICENSE).
