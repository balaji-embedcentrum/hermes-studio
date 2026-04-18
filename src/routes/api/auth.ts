import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * POST /api/auth (password login) — DEPRECATED.
 *
 * The HERMES_PASSWORD-based auth was vulnerable: it defaulted to "allow"
 * when unset, and its requireLocalOrAuth helper trusted X-Forwarded-For.
 * All auth is now Supabase JWT via /api/auth/github.
 */
export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      POST: async () =>
        json(
          {
            ok: false,
            error: 'Password login is no longer supported. Use GitHub sign-in at /api/auth/github.',
          },
          { status: 410 },
        ),
    },
  },
})
