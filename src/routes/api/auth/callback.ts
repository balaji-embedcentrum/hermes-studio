/**
 * GET /api/auth/callback
 *
 * GitHub OAuth callback — exchanges the authorization code for a Supabase
 * session using our manually-stored PKCE verifier cookie.
 *
 * This calls Supabase's raw /auth/v1/token endpoint directly instead of
 * relying on @supabase/ssr's createServerClient, which has known issues
 * with PKCE cookie persistence in TanStack Start / Vinxi.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { provisionProfile } from '../../../server/supabase-auth'
import { getPublicUrl } from '../../../server/request-url'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

function getCookieValue(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export const Route = createFileRoute('/api/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = getPublicUrl(request)
        const code = url.searchParams.get('code')

        if (!code) {
          console.error('[auth/callback] No code in callback URL')
          return Response.redirect(new URL('/?error=no_code', url).toString(), 302)
        }

        // ── Read the PKCE verifier from our explicit cookie ─────────────
        const cookieHeader = request.headers.get('cookie') ?? ''
        const verifier = getCookieValue(cookieHeader, 'hermes_pkce_verifier')

        if (!verifier) {
          console.error('[auth/callback] PKCE verifier cookie not found. Cookies:', cookieHeader)
          return Response.redirect(new URL('/?error=pkce_missing', url).toString(), 302)
        }

        // ── Exchange code + verifier for session via Supabase raw API ───
        let session: {
          access_token: string
          refresh_token: string
          expires_in: number
          token_type: string
          user: { id: string; email?: string; user_metadata?: Record<string, unknown> }
          provider_token?: string
        }

        try {
          const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              auth_code: code,
              code_verifier: verifier,
            }),
          })

          if (!tokenRes.ok) {
            const body = await tokenRes.text()
            console.error('[auth/callback] Token exchange failed:', tokenRes.status, body)
            return Response.redirect(new URL('/?error=token_exchange_failed', url).toString(), 302)
          }

          session = await tokenRes.json()
        } catch (err) {
          console.error('[auth/callback] Token exchange error:', err)
          return Response.redirect(new URL('/?error=token_exchange_error', url).toString(), 302)
        }

        const { access_token, refresh_token, expires_in, provider_token, user } = session

        if (!access_token || !user) {
          console.error('[auth/callback] No access token or user in response')
          return Response.redirect(new URL('/?error=auth_failed', url).toString(), 302)
        }

        // ── Provision profile (first login) ─────────────────────────────
        try {
          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { persistSession: false },
          })

          const { data: existing } = await admin
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single()

          if (!existing) {
            await provisionProfile(admin, user, provider_token ?? null)
          } else if (provider_token) {
            await admin.from('profiles').update({ github_token: provider_token }).eq('id', user.id)
          }
        } catch (err) {
          console.error('[auth/callback] Profile provisioning error:', err)
          // Non-fatal — continue with login
        }

        // ── Set session cookies via Set-Cookie headers (HttpOnly) ───────
        //
        // Session tokens are HttpOnly so they cannot be exfiltrated by
        // in-page JavaScript / XSS. Secure is enforced on HTTPS. Same-site
        // lax is required so GitHub's 302 back into our callback carries
        // cookies; Strict would break the OAuth flow.
        //
        const isHttps = url.protocol === 'https:'
        const secure = isHttps ? '; Secure' : ''
        const encodedAT = encodeURIComponent(access_token)
        const encodedRT = encodeURIComponent(refresh_token ?? '')
        const cookies = [
          `sb-access-token=${encodedAT}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${expires_in}`,
          `sb-refresh-token=${encodedRT}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
          `hermes_pkce_verifier=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`,
          `hermes_force_reauth=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`,
        ]

        console.info('[auth/callback] Login successful for user:', user.id)

        const headers = new Headers({ Location: new URL('/agents', url).toString() })
        for (const c of cookies) headers.append('Set-Cookie', c)

        return new Response(null, { status: 302, headers })
      },
    },
  },
})
