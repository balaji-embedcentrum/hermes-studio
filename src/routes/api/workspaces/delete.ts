/**
 * POST /api/workspaces/delete
 * Permanently deletes a cloned workspace: removes the repo directory from the
 * agent's filesystem, then removes the Supabase `workspaces` row.
 *
 * The agent (hermes-adapter) has no whole-repo delete route, but its
 * `DELETE /ws/{repo}/file` handler `rmtree`s directories — `path=.` resolves
 * to the repo root, so it removes the entire cloned directory from disk.
 * See the tracking issue to replace this with a dedicated `DELETE /ws/{repo}`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { requireJsonContentType } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/workspaces/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const { workspace_id } = (await request.json().catch(() => ({}))) as {
          workspace_id?: string
        }
        if (!workspace_id) return json({ error: 'workspace_id required' }, { status: 400 })

        const admin = getSupabaseServer()
        const { data: workspace } = await admin
          .from('workspaces')
          .select('id, repo_full')
          .eq('id', workspace_id)
          .eq('user_id', auth.userId)
          .single()

        if (!workspace) return json({ error: 'Workspace not found' }, { status: 404 })

        const repoFull: string = workspace.repo_full
        const repoName = repoFull.split('/').pop() ?? repoFull

        // Resolve the user's selected agent and remove the repo directory.
        const agentConfig = await getAgentConfig(auth.userId).catch(() => null)
        if (!agentConfig?.url) {
          return json({ error: 'No agent selected. Go to Agents page first.' }, { status: 400 })
        }
        const agentUrl = agentConfig.url
        const agentHeaders: Record<string, string> = {}
        if (agentConfig.apiKey) agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`

        try {
          const r = await fetch(
            `${agentUrl}/ws/${encodeURIComponent(repoName)}/file?path=${encodeURIComponent('.')}`,
            { method: 'DELETE', headers: agentHeaders },
          )
          // 404 = repo not on this agent (already gone / never cloned). Treat
          // as success so the stale DB row can still be cleared.
          if (!r.ok && r.status !== 404) {
            const d = (await r.json().catch(() => ({}))) as { message?: string }
            return json(
              { error: d.message ?? `Agent returned status ${r.status}` },
              { status: 502 },
            )
          }
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'Agent unreachable' },
            { status: 502 },
          )
        }

        // Repo removed from disk — now drop the workspace record.
        const { error: delErr } = await admin
          .from('workspaces')
          .delete()
          .eq('id', workspace_id)
          .eq('user_id', auth.userId)

        if (delErr) {
          console.error('[workspaces/delete]', delErr.message)
          return json({ error: 'Repo deleted but failed to update records' }, { status: 500 })
        }

        return json({ ok: true })
      },
    },
  },
})
