/**
 * Application-layer encryption for secrets at rest: the
 * `agent_instances.api_key` DB column and the GitHub-token segment of the
 * `sb-access-token` session cookie.
 *
 * Threat model: defends against database-only compromise — a leaked Supabase
 * `service_role` key (e.g. in logs), a leaked backup/replica, a misconfigured
 * RLS policy, or SQL injection. In all of those the attacker gets ciphertext
 * because the key lives on the app server, NOT in Supabase. It does NOT defend
 * against full app-server compromise (attacker has both the key and the DB),
 * which is an accepted, documented limitation. See deploy/KEY-MANAGEMENT.md.
 *
 * Cipher: AES-256-GCM (authenticated — tampering is detected on decrypt).
 * Format: `enc:v1:` + base64( iv(12) | authTag(16) | ciphertext )
 *   - random 12-byte IV per call (GCM nonce reuse is catastrophic — never fixed)
 *   - `v1` version tag enables key rotation without downtime (introduce v2,
 *     write new rows as v2, lazily re-encrypt; a scheme with no version tag
 *     cannot be rotated and is itself a latent hole).
 *
 * Fail-closed by design:
 *   - encryptSecret throws if no key is configured (never silently stores
 *     plaintext while the caller believes it is encrypted).
 *   - decryptSecret of an `enc:` value throws if the key is missing/invalid
 *     (never returns ciphertext as if it were the secret).
 *   - decryptSecret of an un-prefixed value returns it verbatim (legacy
 *     plaintext) during the migration window — see scripts/encrypt-secrets.ts.
 *
 * Never log secret material (plaintext or key) from this module.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32 // AES-256

let cachedKey: Buffer | null = null
let warnedLegacyPlaintext = false

/**
 * Load + validate the 32-byte key from SECRETS_ENCRYPTION_KEY (base64).
 * Throws a clear error if missing or the wrong length.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is not configured. Generate one with ' +
        '`openssl rand -base64 32` and set it in .env (see deploy/KEY-MANAGEMENT.md).',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LEN) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${key.length}). ` +
        'Generate one with `openssl rand -base64 32`.',
    )
  }
  cachedKey = key
  return key
}

/** True iff the value is already in our encrypted envelope format. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/**
 * Encrypt a secret for storage. Throws if the key is not configured —
 * we never silently persist plaintext.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/**
 * Decrypt a value read from the DB.
 *   - null/undefined/empty            -> null
 *   - `enc:v1:` envelope             -> decrypted plaintext (throws if the
 *                                       key is missing/invalid or the auth
 *                                       tag fails — fail closed)
 *   - anything else                   -> returned verbatim (legacy plaintext,
 *                                       migration window only)
 */
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (!isEncrypted(value)) {
    if (!warnedLegacyPlaintext) {
      warnedLegacyPlaintext = true
      console.warn(
        '[secret-crypto] Read a legacy plaintext secret. Run ' +
          '`scripts/encrypt-secrets.ts` to migrate, then this warning stops.',
      )
    }
    return value
  }
  const key = getKey()
  const blob = Buffer.from(value.slice(PREFIX.length), 'base64')
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
