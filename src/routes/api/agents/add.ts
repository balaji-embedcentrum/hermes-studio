/**
 * POST /api/agents/add
 * Body: { name, url, apiKey?, deploymentType: 'user_vps' | 'user_tunnel', model? }
 *
 * Upserts the caller's single personal agent. If the user already has a row
 * with owner_user_id = them, it's UPDATEd in place; otherwise an INSERT.
 * Enforced by the partial unique index `agent_instances_one_per_user`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

const VALID_DEPLOYMENTS = new Set(['user_vps', 'user_tunnel'])

export const Route = createFileRoute('/api/agents/add')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const body = (await request.json().catch(() => ({}))) as {
          name?: string
          url?: string
          apiKey?: string
          deploymentType?: string
          model?: string
        }

        const name = body.name?.trim() ?? ''
        const url = body.url?.trim() ?? ''
        const apiKey = body.apiKey?.trim() ?? ''
        const model = body.model?.trim() || null
        const deploymentType = body.deploymentType ?? ''

        if (!name) return json({ error: 'Name required' }, { status: 400 })
        if (!url) return json({ error: 'URL required' }, { status: 400 })
        if (!VALID_DEPLOYMENTS.has(deploymentType)) {
          return json(
            { error: 'deploymentType must be user_vps or user_tunnel' },
            { status: 400 },
          )
        }

        const admin = getSupabaseServer()

        // Does this user already have a personal agent? If yes, UPDATE; else INSERT.
        const { data: existing } = await admin
          .from('agent_instances')
          .select('id')
          .eq('owner_user_id', auth.userId)
          .limit(1)
          .maybeSingle()

        const row = {
          persona_name: name,
          specialist_type: 'custom',
          container_name: `personal-${auth.userId.slice(0, 8)}`,
          internal_port: 0,
          status: 'idle',
          agent_status: 'available',
          api_url: url,
          api_key: apiKey || null,
          model_name: model,
          skills: ['Custom'],
          owner_user_id: auth.userId,
          deployment_type: deploymentType,
          health_fail_count: 0,
        }

        if (existing?.id) {
          const { data, error } = await admin
            .from('agent_instances')
            .update(row)
            .eq('id', existing.id)
            .eq('owner_user_id', auth.userId)
            .select('id, persona_name, api_url, deployment_type')
            .single()
          if (error) {
            console.error('[agents/add] update failed:', error.message)
            return json({ error: error.message }, { status: 500 })
          }
          return json({ ok: true, agent: data })
        }

        const { data, error } = await admin
          .from('agent_instances')
          .insert(row)
          .select('id, persona_name, api_url, deployment_type')
          .single()
        if (error) {
          console.error('[agents/add] insert failed:', error.message)
          return json({ error: error.message }, { status: 500 })
        }
        return json({ ok: true, agent: data })
      },
    },
  },
})
