/**
 * GET /api/agent-sessions/status
 * Returns the user's current session info + time remaining.
 * Used by the client-side timer to stay in sync with server.
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
