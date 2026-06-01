# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: go to the **Security** tab →
**Report a vulnerability**. That opens a private advisory visible only to the
maintainers.

Please include:
- what the issue is and the impact,
- steps to reproduce (a minimal PoC if possible),
- affected route/file/version.

We aim to acknowledge reports within a few days and to ship a fix or mitigation
before any public disclosure. Coordinated disclosure is appreciated.

## Supported versions

This is an actively developed project; fixes land on `main`. Please test
against the latest `main` before reporting.

## Security model (so reports land in the right place)

Hermes Studio is the `studio-core` engine; the AI **agent gateway** it talks to
(`HERMES_API_URL`) is a separate component with its own security posture.

- **Row-Level Security is the authorization boundary.** The browser uses the
  Supabase **anon key, which is public by design** (it is baked into the client
  bundle). All data access from the client is constrained by Postgres RLS
  policies scoped to `auth.uid()`. A missing or overly-permissive RLS policy is
  a valid, high-value report.
- **The service key bypasses RLS** and is used only in server-side route
  handlers. It (and `HERMES_API_TOKEN`) are never sent to the browser.
- **Secrets at rest** — `agent_instances.api_key` and the stored GitHub token
  are AES-256-GCM encrypted (`enc:v1:` envelope) with `SECRETS_ENCRYPTION_KEY`,
  separate from the Supabase keys (`src/server/secret-crypto.ts`).
- **Auth** — GitHub OAuth via Supabase using a manual PKCE flow; the verifier
  lives in an HttpOnly cookie, and the code-for-session exchange is server-side.

### Out of scope
- Findings that require a leaked `SUPABASE_SERVICE_KEY` / `SECRETS_ENCRYPTION_KEY`
  (these are operator secrets — protecting them is a deployment concern).
- The public Supabase **anon key** appearing in the client bundle — this is
  intentional and safe *provided RLS is correct* (report the RLS gap instead).
- Rate-limiting / DoS at the edge (handled by the deployment's CDN/WAF).
