import { createFileRoute } from '@tanstack/react-router'
import {
  HERMES_API,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import { getAuthUser } from '../../server/supabase-auth'

type PingResponse = {
  ok: boolean
  error?: string
  status?: number
  hermesUrl: string
}

/**
 * GET /api/ping — connection health probe used by the chat UI to show the
 * "Connection lost" banner when things are broken.
 *
 * Behavior by user type:
 * - Authenticated (Supabase JWT cookie): always OK. Cloud users talk to a
 *   remote agent via the Supabase agent registry, not a local Hermes
 *   install. A failing local probe is irrelevant to them and caused
 *   constant 503s / false "connection lost" toasts.
 * - Unauthenticated local dev: probe the local Hermes gateway health as
 *   before; report 503 if it's down so the UI can prompt to start it.
 */
export const Route = createFileRoute('/api/ping')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getAuthUser(request).catch(() => null)
        if (user) {
          return Response.json(
            { ok: true, status: 200, hermesUrl: HERMES_API } satisfies PingResponse,
            { status: 200 },
          )
        }

        // Unauthenticated — treat as local dev, probe the local gateway.
        const caps = await ensureGatewayProbed()
        if (!caps.health) {
          return Response.json(
            {
              ok: false,
              error: 'Hermes unavailable',
              status: 503,
              hermesUrl: HERMES_API,
            } satisfies PingResponse,
            { status: 503 },
          )
        }

        return Response.json(
          { ok: true, status: 200, hermesUrl: HERMES_API } satisfies PingResponse,
          { status: 200 },
        )
      },
    },
  },
})
