/**
 * POST /api/auth/logout
 * Ends active agent sessions and clears HttpOnly session cookies via
 * Set-Cookie headers. Cookies are HttpOnly server-set — client JS cannot
 * clear them, so the server emits the expiring Set-Cookie.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getAuthUser } from '../../../server/supabase-auth'
import { endAllUserSessions } from '../../../server/agent-sessions'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getAuthUser(request).catch(() => null)
        if (auth?.userId) {
          await endAllUserSessions(auth.userId, 'logout').catch(() => {})
        }

        const isHttps = new URL(request.url).protocol === 'https:'
        const secure = isHttps ? '; Secure' : ''
        const expire = (name: string) =>
          `${name}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`

        const headers = new Headers({ 'Content-Type': 'application/json' })
        headers.append('Set-Cookie', expire('sb-access-token'))
        headers.append('Set-Cookie', expire('sb-refresh-token'))
        headers.append(
          'Set-Cookie',
          `hermes_force_reauth=1; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=600`,
        )

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
      },
    },
  },
})
