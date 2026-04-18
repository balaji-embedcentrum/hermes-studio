/**
 * GET /api/agents/list
 * Returns available agents from Supabase agent_instances table.
 * Agent URLs are NOT exposed to clients — only metadata.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/agents/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const admin = getSupabaseServer()
        const { data: agents, error } = await admin
          .from('agent_instances')
          .select('id, persona_name, specialist_type, status, container_name, model_name, skills, agent_status, cooldown_until, locked_to_user')
          .in('status', ['idle', 'busy'])
          .order('persona_name')

        if (error) {
          console.error('[agents/list]', error.message)
          return json({ agents: [] })
        }

        return json({ agents: agents ?? [] })
      },
    },
  },
})
