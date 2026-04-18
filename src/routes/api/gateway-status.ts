import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getAuthUser } from '../../server/supabase-auth'
import {
  HERMES_API,
  ensureGatewayProbed,
  getAgentConfig,
} from '../../server/gateway-capabilities'

const PROBE_TIMEOUT_MS = 3_000

export const Route = createFileRoute('/api/gateway-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAuthenticated(request))) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check if user has a selected remote agent
        const authUser = await getAuthUser(request).catch(() => null)
        let agentUrl: string | null = null
        if (authUser?.userId) {
          try {
            const config = await getAgentConfig(authUser.userId)
            if (config.url !== HERMES_API) {
              agentUrl = config.url
            }
          } catch {
            // Agent lookup failed — fall through to localhost probe.
            // The chat endpoint will surface the real error when the user sends a message.
          }
        }

        // If user has a remote agent, probe IT instead of localhost
        if (agentUrl) {
          const [isHealthy, hasChatCompletions] = await Promise.all([
            fetch(`${agentUrl}/health`, {
              signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            }).then((r) => r.ok).catch(() => false),
            fetch(`${agentUrl}/v1/chat/completions`, {
              method: 'GET',
              signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            }).then((r) =>
              r.status === 405 || r.ok || r.status === 400 || r.status === 422,
            ).catch(() => false),
          ])

          return json({
            capabilities: {
              health: isHealthy,
              chatCompletions: hasChatCompletions,
              models: isHealthy,
              streaming: hasChatCompletions,
              sessions: false,
              enhancedChat: false,
              skills: false,
              memory: false,
              config: false,
              jobs: false,
              probed: true,
            },
            hermesUrl: agentUrl,
          })
        }

        // No remote agent selected — probe localhost as before
        const capabilities = await ensureGatewayProbed()
        return json({
          capabilities,
          hermesUrl: HERMES_API,
        })
      },
    },
  },
})
