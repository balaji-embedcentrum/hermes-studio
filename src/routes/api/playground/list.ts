/**
 * GET /api/playground/list
 * Returns the curated public "Playground" projects — a small admin-managed
 * set (rows added directly in the Supabase `playground_projects` table).
 * Global list, identical for every signed-in user. Behind auth like the
 * rest of /projects; the clone flow itself is unchanged (a playground repo
 * is just a public repo_full fed to the existing open → clone path).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'

export const Route = createFileRoute('/api/playground/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const admin = getSupabaseServer()
        const { data: projects, error } = await admin
          .from('playground_projects')
          .select(
            'id, repo_full, repo_url, name, description, tags, default_branch, sort_order',
          )
          .eq('is_active', true)
          // Only surface Sylang playground projects.
          .contains('tags', ['sylang'])
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (error) {
          console.error('[playground/list]', error.message)
          return json({ projects: [] })
        }

        return json({ projects: projects ?? [] })
      },
    },
  },
})
