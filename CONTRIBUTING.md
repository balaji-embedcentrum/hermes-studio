# Contributing

Thanks for your interest in Hermes Studio. This repo is the `studio-core`
engine that ships as two brands (Hermes Studio / Sylang Studio) from one
codebase — please keep that in mind when making changes (see
[Branding](#branding-rule) below).

## Prerequisites

- **Node ≥ 22**
- **pnpm 9** (the lockfile is `lockfileVersion: 9.0`; pnpm 10/11 ignore the
  `pnpm` field in `package.json` and drop our overrides + patch — use 9)

## Getting started

```bash
pnpm install                 # postinstall syncs the editor bundles into public/
cp .env.example .env         # fill SUPABASE_* + HERMES_API_URL (see README)
pnpm dev:hermes              # or pnpm dev:sylang  →  http://localhost:3000
```

Full setup and the data model are in the [README](README.md).

## Development workflow

1. **Branch** off `main` — `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Make focused changes; keep PRs small and single-purpose.
3. **Format + lint** before pushing:
   ```bash
   pnpm check        # prettier --write + eslint --fix
   pnpm test         # vitest
   ```
4. Open a **pull request to `main`** with a clear description of *what* and
   *why*. Reference any related issue.

### Commit messages
We use [Conventional Commits](https://www.conventionalcommits.org/):
`feat: …`, `fix: …`, `docs: …`, `chore: …`, `refactor: …`. Scope is optional
(`fix(build): …`). This keeps history readable and changelogs easy.

## Branding rule

The two products differ **only** through `src/brand/` (see the README's
"Branding" section). When you touch shared code:

- **Don't hardcode** brand strings/logos/colors (`"Sylang Studio"`,
  `/hermes-crest.svg`, etc.) — read them from `brand` (`@/brand`).
- New brand-specific behavior belongs behind the `Brand` interface (e.g.
  `brand.showMbseTools`), not an `if (brand.id === 'sylang')` sprinkled around.
- Themes are declared as `@theme` blocks in `src/styles.css` (Tailwind 4 only
  generates utilities for colors registered there).

## Things to know

- **Never commit secrets.** `.env` is gitignored; only the two public Supabase
  values are ever exposed to the client. Server-only vars must **not** carry a
  `VITE_` prefix.
- **SSE routes** must keep `Cache-Control: no-cache, no-transform` +
  `X-Accel-Buffering: no` so streams aren't buffered/compressed by
  intermediaries.
- **Security issues:** do not file public issues — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
