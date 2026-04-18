/**
 * POST /api/auth/logout
 * Clears session cookies via client-side script and redirects to landing page.
 * Uses the same approach as callback — TanStack Start strips Set-Cookie from 302.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getAuthUser } from '../../../server/supabase-auth'
import { endAllUserSessions } from '../../../server/agent-sessions'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // End any active agent sessions before logout
        const auth = await getAuthUser(request).catch(() => null)
        if (auth?.userId) {
          await endAllUserSessions(auth.userId, 'logout').catch(() => {})
        }
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signing out...</title></head>
<body>
<script>
document.cookie = "sb-access-token=; path=/; max-age=0;";
document.cookie = "sb-refresh-token=; path=/; max-age=0;";
document.cookie = "hermes_force_reauth=1; path=/; max-age=600; samesite=lax;";
window.location.replace("/");
</script>
</body></html>`
        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
