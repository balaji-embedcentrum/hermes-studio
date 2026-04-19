/**
 * POST /api/auth/logout
 * Ends active agent sessions and clears HttpOnly session cookies via
 * Set-Cookie headers. Cookies are HttpOnly server-set — client JS cannot
 * clear them, so the server emits the expiring Set-Cookie.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getAuthUser } from '../../../server/supabase-auth'
import { endAllUserSessions } from '../../../server/agent-sessions'
import { getPublicUrl } from '../../../server/request-url'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getAuthUser(request).catch(() => null)
        if (auth?.userId) {
          await endAllUserSessions(auth.userId, 'logout').catch(() => {})
        }

        const isHttps = getPublicUrl(request).protocol === 'https:'
        const secure = isHttps ? '; Secure' : ''
        const expire = (name: string) =>
          `${name}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`

        // Array-of-pairs (see callback.ts for rationale) — ensures each
        // Set-Cookie becomes its own header line rather than comma-merged.
        const headers: Array<[string, string]> = [
          ['Content-Type', 'application/json'],
          ['Set-Cookie', expire('sb-access-token')],
          ['Set-Cookie', expire('sb-refresh-token')],
          ['Set-Cookie', `hermes_force_reauth=1; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=600`],
        ]

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
      },
    },
  },
})
