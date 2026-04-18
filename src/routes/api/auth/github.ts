/**
 * GET /api/auth/github
 *
 * Initiates GitHub OAuth via Supabase using manual PKCE.
 * Generates the PKCE pair ourselves, stores the verifier in a plain
 * HttpOnly cookie, and redirects to Supabase's /auth/v1/authorize.
 *
 * This bypasses @supabase/ssr's cookie adapter entirely — the cookie
 * is explicit, simple, and works across every SSR framework.
 */
import { createFileRoute } from '@tanstack/react-router'
import { randomBytes, createHash } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!

export const Route = createFileRoute('/api/auth/github')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const origin = url.origin
        const isHttps = url.protocol === 'https:'

        // ── Generate PKCE pair ──────────────────────────────────────────
        const verifier = randomBytes(32).toString('base64url')
        const challenge = createHash('sha256').update(verifier).digest('base64url')

        // ── Build the Supabase authorize URL ────────────────────────────
        const params = new URLSearchParams({
          provider: 'github',
          redirect_to: `${origin}/api/auth/callback`,
          scopes: 'read:user user:email repo',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })
        const authUrl = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`

        // ── Store verifier in a plain cookie ────────────────────────────
        const secure = isHttps ? '; Secure' : ''
        const cookie = `hermes_pkce_verifier=${verifier}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=600`

        console.info('[auth/github] PKCE verifier stored, redirecting to GitHub')

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            'Set-Cookie': cookie,
          },
        })
      },
    },
  },
})
