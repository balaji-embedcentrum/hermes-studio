/**
 * GET /api/agent-sessions/health-check
 * Pings all remote agents, updates their status in Supabase.
 * Called by a cron job or client-side polling.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { runHealthChecks } from '../../../server/agent-sessions'

export const Route = createFileRoute('/api/agent-sessions/health-check')({
  server: {
    handlers: {
      GET: async () => {
        const result = await runHealthChecks()
        return json(result)
      },
    },
  },
})
