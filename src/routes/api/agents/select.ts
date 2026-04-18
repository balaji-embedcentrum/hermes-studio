/**
 * POST /api/agents/select
 * Body: { agentId }
 *
 * Selects an agent for the current user. Returns the agent's API URL
 * (server-side only — never exposed to client).
 * Stores selection in user's profile.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

// Agent URL mapping — server-side only, never sent to client
const AGENT_URLS: Record<string, string> = {
  // Map container_name to internal URL
  // These are populated from env or hardcoded for known agents
}

// Populate from env if available
if (process.env.AGENT_URLS) {
  try {
    const parsed = JSON.parse(process.env.AGENT_URLS)
    Object.assign(AGENT_URLS, parsed)
  } catch {}
}

export const Route = createFileRoute('/api/agents/select')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { agentId } = await request.json() as { agentId: string }
        if (!agentId) return json({ error: 'agentId required' }, { status: 400 })

        const admin = getSupabaseServer()

        // Verify agent exists
        const { data: agent } = await admin
          .from('agent_instances')
          .select('id, persona_name, container_name, status')
          .eq('id', agentId)
          .single()

        if (!agent) return json({ error: 'Agent not found' }, { status: 404 })

        // Store selection in user profile
        const { error: updateError } = await admin
          .from('profiles')
          .update({ selected_agent_id: agentId })
          .eq('id', auth.userId)

        if (updateError) {
          console.error('[agents/select] Profile update failed:', updateError.message)
          return json({ error: `Failed to save selection: ${updateError.message}` }, { status: 500 })
        }
        console.info(`[agents/select] User ${auth.userId} selected agent ${agent.persona_name} (${agent.id})`)

        return json({
          ok: true,
          agent: {
            id: agent.id,
            name: agent.persona_name,
            status: agent.status,
          },
        })
      },
    },
  },
})
