/**
 * GET /api/workspaces/list
 * Returns all workspaces for the authenticated user from the Supabase workspaces table.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/workspaces/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const admin = getSupabaseServer()
        const { data: workspaces, error } = await admin
          .from('workspaces')
          .select('repo_full, fs_path, last_accessed, created_at')
          .eq('user_id', auth.userId)
          .order('last_accessed', { ascending: false, nullsFirst: false })

        if (error) {
          console.error('[workspaces/list]', error.message)
          return json({ workspaces: [] })
        }

        // Add the workspace path in the same format the clone flow uses: userId/repo_full
        const enriched = (workspaces ?? []).map(w => ({
          ...w,
          workspace_path: `${auth.userId}/${w.repo_full}`,
        }))

        return json({ workspaces: enriched })
      },
    },
  },
})
