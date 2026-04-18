/**
 * POST /api/agent-sessions/end
 * Body: { reason? } — optional reason (user_ended, logout, etc.)
 * Ends the user's active session and starts agent cooldown.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { endSession, type SessionEndReason } from '../../../server/agent-sessions'

const VALID_REASONS = new Set<SessionEndReason>(['user_ended', 'logout', 'idle'])

export const Route = createFileRoute('/api/agent-sessions/end')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const body = await request.json().catch(() => ({})) as { reason?: string }
        const reason: SessionEndReason = VALID_REASONS.has(body.reason as SessionEndReason)
          ? (body.reason as SessionEndReason)
          : 'user_ended'

        const result = await endSession(auth.userId, reason)
        return json(result)
      },
    },
  },
})
