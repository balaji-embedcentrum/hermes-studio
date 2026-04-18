/**
 * GET /api/github/repos
 * Returns the authenticated user's GitHub repositories.
 * Uses the github_token stored in their profile (server-side only).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'

export const Route = createFileRoute('/api/github/repos')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const token = auth.profile.github_token
        console.log('[github/repos] token present:', !!token)
        if (!token) return json({ error: 'No GitHub token — please sign out and sign in again' }, { status: 400 })

        // Fetch repos from GitHub API (first 100, sorted by update time)
        const res = await fetch(
          'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator',
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        )

        if (!res.ok) {
          const msg = await res.text()
          console.error('[github/repos] GitHub API error:', res.status, msg)
          return json({ error: 'GitHub API error', status: res.status }, { status: 502 })
        }

        const repos = await res.json()
        return json({ repos })
      },
    },
  },
})
