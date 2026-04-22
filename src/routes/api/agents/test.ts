/**
 * POST /api/agents/test
 * Body: { id }
 *
 * Probes the caller's personal agent and reports whether it's reachable.
 * Only works on agents the caller owns (owner_user_id = auth.userId).
 * Used by the /agents UI "Test" button + shown to the user when we think
 * the agent is down so they can take corrective action.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

type TestResult =
  | { ok: true; latencyMs: number; status: number }
  | {
      ok: false
      reason: 'not_found' | 'timeout' | 'auth_failed' | 'unreachable'
      message: string
    }

const PROBE_TIMEOUT_MS = 5_000
// Same cascade as runHealthChecks — /health first, /v1/health second.
const HEALTH_PATHS = ['/health', '/v1/health'] as const

export const Route = createFileRoute('/api/agents/test')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const body = (await request.json().catch(() => ({}))) as { id?: string }
        const id = body.id?.trim()
        if (!id) return json({ error: 'id required' }, { status: 400 })

        const admin = getSupabaseServer()
        const { data: agent } = await admin
          .from('agent_instances')
          .select('id, api_url, api_key, owner_user_id')
          .eq('id', id)
          .eq('owner_user_id', auth.userId)
          .maybeSingle()

        if (!agent || !agent.api_url) {
          return json(
            {
              ok: false,
              reason: 'not_found',
              message: 'Agent not found or not yours',
            } satisfies TestResult,
            { status: 404 },
          )
        }

        const headers: Record<string, string> = {}
        if (agent.api_key) headers['Authorization'] = `Bearer ${agent.api_key}`

        let lastStatus = 0
        const startedAt = Date.now()
        for (const path of HEALTH_PATHS) {
          try {
            const res = await fetch(`${agent.api_url}${path}`, {
              headers,
              signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            })
            if (res.ok) {
              return json({
                ok: true,
                latencyMs: Date.now() - startedAt,
                status: res.status,
              } satisfies TestResult)
            }
            lastStatus = res.status
            if (res.status === 401 || res.status === 403) {
              return json({
                ok: false,
                reason: 'auth_failed',
                message: `Agent responded ${res.status} — API key is wrong or expired`,
              } satisfies TestResult)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('AbortError') || msg.includes('timed out')) {
              return json({
                ok: false,
                reason: 'timeout',
                message: `No response within ${PROBE_TIMEOUT_MS}ms`,
              } satisfies TestResult)
            }
            // fall through to next path
          }
        }

        return json({
          ok: false,
          reason: 'unreachable',
          message:
            lastStatus > 0
              ? `Agent responded ${lastStatus} on /health and /v1/health`
              : 'No response on /health or /v1/health',
        } satisfies TestResult)
      },
    },
  },
})
