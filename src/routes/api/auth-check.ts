/**
 * GET /api/auth-check
 * Returns authentication status for the workspace shell.
 * Auth (Supabase session) is checked independently of gateway availability.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAuthUser } from '../../server/supabase-auth'

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuthUser(request)
        return json({
          authenticated: !!auth,
          authRequired: true,
          userId: auth?.userId ?? null,
          githubLogin: auth?.profile.github_login ?? null,
          credits: auth?.profile.credits ?? 0,
          tier: auth?.profile.tier ?? null,
        })
      },
    },
  },
})
