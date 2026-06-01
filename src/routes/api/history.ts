import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  listSessions,
  toChatMessage,
} from '../../server/hermes-api'
import { resolveSessionKey } from '../../server/session-utils'
import { isAuthenticated } from '@/server/auth-middleware'
import { getAuthUser } from '@/server/supabase-auth'

export const Route = createFileRoute('/api/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAuthenticated(request))) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return json({
            sessionKey: 'new',
            sessionId: 'new',
            messages: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }
        try {
          const url = new URL(request.url)
          const limit = Number(url.searchParams.get('limit') || '200')
          const rawSessionKey = url.searchParams.get('sessionKey')?.trim()
          const friendlyId = url.searchParams.get('friendlyId')?.trim()
          let { sessionKey } = await resolveSessionKey({
            rawSessionKey,
            friendlyId,
            defaultKey: 'main',
          })

          // send-stream stores agent sessions under `${userId}:${sessionKey}`
          // (see send-stream.ts portable-mode `agentSessionId` construction).
          // History fetch MUST apply the same prefix or we'll either miss the
          // session entirely (for `s_*` sidebar keys) or fall back to the
          // wrong session (for `main`, where the fallback grabs the most
          // recent agent session regardless of which friendlyId the user
          // actually clicked). Pull the userId from the auth cookie and
          // mirror the same key format.
          const authUser = await getAuthUser(request).catch(() => null)
          const userId = authUser?.userId
          const agentSessionId = userId ? `${userId}:${sessionKey}` : sessionKey

          // For the legacy "main" / "new" placeholders that pre-date the
          // userId-prefixed scheme, still fall back to the latest session
          // when the userId-prefixed lookup turns up nothing — protects
          // existing chats that were created before this prefix landed.
          let messages: Awaited<ReturnType<typeof getMessages>> = []
          try {
            messages = await getMessages(agentSessionId)
          } catch {
            messages = []
          }
          if (
            messages.length === 0 &&
            (sessionKey === 'main' || sessionKey === 'new')
          ) {
            try {
              const sessions = await listSessions(1, 0)
              if (sessions.length > 0) {
                sessionKey = sessions[0].id
                messages = await getMessages(sessionKey)
              } else {
                return json({
                  sessionKey: 'new',
                  sessionId: 'new',
                  messages: [],
                })
              }
            } catch {
              return json({ sessionKey: 'new', sessionId: 'new', messages: [] })
            }
          }
          const boundedMessages = limit > 0 ? messages.slice(-limit) : messages

          return json({
            sessionKey,
            sessionId: sessionKey,
            messages: boundedMessages.map((message, index) =>
              toChatMessage(message, { historyIndex: index }),
            ),
          })
        } catch (err) {
          return json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
