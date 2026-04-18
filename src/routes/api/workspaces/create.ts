/**
 * POST /api/workspaces/create
 * Body: { name }
 *
 * Creates a new empty project on the agent and registers it in Supabase.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'
import { getAgentConfig } from '../../../server/gateway-capabilities'

export const Route = createFileRoute('/api/workspaces/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { name } = await request.json() as { name: string }
        if (!name?.trim()) return json({ error: 'Project name required' }, { status: 400 })

        const projectName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_')

        try {
          // Resolve the user's selected agent
          const agentConfig = await getAgentConfig(auth.userId).catch(() => null)
          const agentUrl = agentConfig?.url
          if (agentUrl) {
            const agentHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
            if (agentConfig?.apiKey) agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`

            const initRes = await fetch(`${agentUrl}/ws/${encodeURIComponent(projectName)}/init`, {
              method: 'POST',
              headers: agentHeaders,
              body: JSON.stringify({ empty: true }),
            })
            console.info(`[workspaces/create] Agent init response: ${initRes.status}`)

            if (!initRes.ok) {
              console.info('[workspaces/create] Init failed, trying direct file write')
              await fetch(`${agentUrl}/ws/${encodeURIComponent(projectName)}/file`, {
                method: 'POST',
                headers: agentHeaders,
                body: JSON.stringify({ path: '.gitkeep', content: '' }),
              })
            }
          }

          // Register in Supabase workspaces table
          const admin = getSupabaseServer()
          const repoFull = `${auth.profile.github_login}/${projectName}`
          const fsPath = `/workspaces/${auth.userId}/${repoFull}`

          await admin.from('workspaces').upsert([{
            user_id: auth.userId,
            repo_full: repoFull,
            repo_url: '',
            fs_path: fsPath,
            size_mb: 0,
          }], { onConflict: 'user_id,repo_full' })

          const workspacePath = `${auth.userId}/${repoFull}`

          return json({ ok: true, path: workspacePath })
        } catch (e) {
          console.error('[workspaces/create]', e)
          return json({ error: `Failed to create project: ${e}` }, { status: 500 })
        }
      },
    },
  },
})
