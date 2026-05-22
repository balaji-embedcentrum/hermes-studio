# Secret Encryption Key (`SECRETS_ENCRYPTION_KEY`)

Encrypts `agent_instances.api_key` and `profiles.github_token` at rest
(AES-256-GCM). Code: `src/server/secret-crypto.ts`.

## What it protects (and what it doesn't)

Defends **database-only** compromise: leaked Supabase `service_role` key,
leaked backup/replica, RLS misconfig, SQL injection → attacker gets
ciphertext because the key lives on the app server, not in Supabase.

Does **not** defend full app-server compromise (attacker has both the
`.env` and DB access). Accepted, by design. RLS on `profiles` /
`agent_instances` is the complementary control for the anon-key path.

## Generate

```bash
openssl rand -base64 32   # decodes to exactly 32 bytes
```

Put it in `.env` next to the other server-only secrets. Different key per
environment. Never commit it; never log it. `chmod 600 .env`.

## Back it up (mandatory)

Every other secret is regenerable — this one is **not**. Lose it and every
encrypted `api_key` / `github_token` is permanently unrecoverable. Keep one
copy in an offline password manager, outside git and outside Supabase.

## Roll out

1. Set `SECRETS_ENCRYPTION_KEY` in `.env`.
2. `node scripts/encrypt-secrets.mjs` (idempotent — backfills existing
   plaintext rows; safe to re-run).
3. Deploy the code. Reads of legacy plaintext still work and log a one-time
   warning until step 2 completes.

Writes fail closed if the key is unset — login/agent-add will error rather
than silently store plaintext.

## Rotate

The envelope is tagged `enc:v1:`. To rotate: introduce a v2 key, write new
rows as v2, re-encrypt v1 rows, then retire v1. (v2 path is added when
first needed — the version tag is what makes rotation possible at all.)
