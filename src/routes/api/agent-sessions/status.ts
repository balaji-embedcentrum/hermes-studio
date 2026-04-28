/**
 * GET /api/agent-sessions/status
 * Returns the user's current session info + time remaining.
 * Used by the client-side timer to stay in sync with server.
 *
 * Also returns `hasPersonalAgent` so BYO single-tenant users (user_vps,
 * user_tunnel) can be treated as "has session" by useActiveSession,
 * preventing the global SessionEndRedirect in __root.tsx from booting
 * them out of /projects, /files, /chat, etc. (BYO doesn't create
 * session rows — see PR #47.)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSessionStatus } from '../../../server/agent-sessions'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/agent-sessions/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ session: null, hasPersonalAgent: false })

        const session = await getSessionStatus(auth.userId)

        const admin = getSupabaseServer()
        const { data: personal } = await admin
          .from('agent_instances')
          .select('id')
          .eq('owner_user_id', auth.userId)
          .limit(1)
          .maybeSingle()

        return json({ session, hasPersonalAgent: Boolean(personal) })
      },
    },
  },
})
