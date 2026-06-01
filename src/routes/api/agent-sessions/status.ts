/**
 * GET /api/agent-sessions/status
 * Returns the user's current session info + time remaining.
 * Used by the client-side timer + useActiveSession to gate the chat UI.
 *
 * Previously also returned `hasPersonalAgent` so BYO single-tenant users
 * (user_vps, user_tunnel) could be treated as always-having-session even
 * with no active session row. BYO is hidden from the UI now (playground
 * agents only), so a leftover agent_instances row was bypassing the
 * lock — see PR removing the bypass.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSessionStatus } from '../../../server/agent-sessions'

export const Route = createFileRoute('/api/agent-sessions/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ session: null })

        const session = await getSessionStatus(auth.userId)
        return json({ session })
      },
    },
  },
})
