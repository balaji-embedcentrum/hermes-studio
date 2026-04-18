/**
 * POST /api/workspaces/open
 * Creates or retrieves an existing workspace record for a repo.
 * Returns the workspace id.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/workspaces/open')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { repo_full, repo_url } = await request.json() as { repo_full: string; repo_url: string }
        if (!repo_full) return json({ error: 'repo_full required' }, { status: 400 })

        const admin = getSupabaseServer()

        // Check if workspace already exists
        const { data: existing } = await admin
          .from('workspaces')
          .select('id')
          .eq('user_id', auth.userId)
          .eq('repo_full', repo_full)
          .maybeSingle()

        if (existing) return json({ workspace_id: existing.id })

        // Create new workspace record
        const fs_path = `/workspaces/${auth.userId}/${repo_full}`
        const { data: workspace, error } = await admin
          .from('workspaces')
          .insert([{
            user_id: auth.userId,
            repo_full,
            repo_url,
            fs_path,
            size_mb: 0,
          }])
          .select('id')
          .single()

        if (error) {
          console.error('[workspaces/open] insert error:', error.message)
          return json({ error: 'Failed to create workspace' }, { status: 500 })
        }

        return json({ workspace_id: workspace.id })
      },
    },
  },
})
