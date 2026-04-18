/**
 * POST /api/agent-sessions/start
 * Body: { agentId }
 * Starts a new agent session for the authenticated user.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { startSession } from '../../../server/agent-sessions'

export const Route = createFileRoute('/api/agent-sessions/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const body = await request.json().catch(() => ({})) as { agentId?: string }
        if (!body.agentId) return json({ ok: false, error: 'agentId required' }, { status: 400 })

        const result = await startSession(auth.userId, body.agentId)
        if (result.ok) {
          return json({ ok: true, session: result.session })
        }
        const status = result.code === 'no_credits' ? 402 : 409
        return json({ ok: false, error: result.error, code: result.code }, { status })
      },
    },
  },
})
