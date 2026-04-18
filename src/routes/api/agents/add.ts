/**
 * POST /api/agents/add
 * Body: { name, url, model }
 * Adds a custom agent (local or remote) to the agent_instances table.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/agents/add')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { name, url, model, apiKey } = await request.json() as { name: string; url: string; model?: string; apiKey?: string }
        if (!name?.trim() || !url?.trim()) return json({ error: 'Name and URL required' }, { status: 400 })

        const admin = getSupabaseServer()
        const { error } = await admin.from('agent_instances').insert([{
          persona_name: name.trim(),
          specialist_type: 'custom',
          container_name: `custom-${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
          internal_port: 8642,
          status: 'idle',
          api_url: url.trim(),
          model_name: model?.trim() || null,
          api_key: apiKey?.trim() || null,
          skills: ['Custom'],
        }])

        if (error) {
          console.error('[agents/add]', error.message)
          return json({ error: error.message }, { status: 500 })
        }

        return json({ ok: true })
      },
    },
  },
})
