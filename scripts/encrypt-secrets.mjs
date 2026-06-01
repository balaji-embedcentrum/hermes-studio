/**
 * One-time migration: encrypt existing plaintext secrets at rest.
 *
 *   profiles.github_token   (GitHub OAuth token, repo scope)
 *   agent_instances.api_key (agent bearer token)
 *
 * Idempotent — rows already in `enc:v1:` format are skipped, so it is safe
 * to re-run. Uses the same envelope format as src/server/secret-crypto.ts.
 *
 * Run AFTER SECRETS_ENCRYPTION_KEY is set and BEFORE (or with) the new code
 * is live:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SECRETS_ENCRYPTION_KEY=... \
 *     node scripts/encrypt-secrets.mjs
 *
 * Never logs secret material.
 */
import { createCipheriv, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const PREFIX = 'enc:v1:'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SECRETS_ENCRYPTION_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const key = Buffer.from(SECRETS_ENCRYPTION_KEY ?? '', 'base64')
if (key.length !== 32) {
  console.error('SECRETS_ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32)')
  process.exit(1)
}

function encrypt(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

async function migrate(table, idCol, col) {
  const { data, error } = await db.from(table).select(`${idCol}, ${col}`)
  if (error) throw new Error(`${table}: ${error.message}`)
  let migrated = 0
  let skipped = 0
  for (const row of data ?? []) {
    const val = row[col]
    if (!val) continue
    if (typeof val === 'string' && val.startsWith(PREFIX)) {
      skipped++
      continue
    }
    const { error: upErr } = await db
      .from(table)
      .update({ [col]: encrypt(val) })
      .eq(idCol, row[idCol])
    if (upErr) throw new Error(`${table} ${row[idCol]}: ${upErr.message}`)
    migrated++
  }
  console.log(`${table}.${col}: encrypted ${migrated}, already-encrypted ${skipped}`)
}

await migrate('profiles', 'id', 'github_token')
await migrate('agent_instances', 'id', 'api_key')
console.log('Done.')
