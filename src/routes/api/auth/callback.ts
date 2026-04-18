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
        const url = new URL(request.url)
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

        // ── Set session cookies via client-side script, then redirect ────
        //
        // TanStack Start strips Set-Cookie headers from Response objects
        // returned by server handlers. There is no workaround within the
        // framework — so we return an HTML page whose inline script sets
        // the cookies via document.cookie and then navigates to /projects.
        //
        const isHttps = url.protocol === 'https:'
        const secure = isHttps ? ' Secure;' : ''

        console.info('[auth/callback] Login successful for user:', user.id)

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing in...</title></head>
<body>
<script>
(function(){
  var at = ${JSON.stringify(access_token)};
  var rt = ${JSON.stringify(refresh_token ?? '')};
  var ex = ${JSON.stringify(expires_in)};
  document.cookie = "sb-access-token=" + encodeURIComponent(at) + "; path=/; max-age=" + ex + "; samesite=lax;${secure}";
  document.cookie = "sb-refresh-token=" + encodeURIComponent(rt) + "; path=/; max-age=" + (60*60*24*30) + "; samesite=lax;${secure}";
  document.cookie = "hermes_pkce_verifier=; path=/; max-age=0;";
  document.cookie = "hermes_force_reauth=; path=/; max-age=0;";
  window.location.replace("/agents");
})();
</script>
<noscript><a href="/agents">Click here to continue</a></noscript>
</body></html>`

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
