import { createFileRoute } from '@tanstack/react-router'
import { getAuthUser } from '../../server/supabase-auth'
import {
  ensureBusStarted,
  subscribeToChatEvents,
} from '../../server/chat-event-bus'

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Require Supabase auth. Without this the SSE stream leaked every
        // user's chat events to anonymous subscribers.
        const auth = await getAuthUser(request)
        if (!auth) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Require an explicit sessionKey — callers must say WHICH chat
        // they're listening to. The bus filter then only delivers events
        // whose data.sessionKey matches. (Ownership of the sessionKey
        // itself is enforced at write time — send-stream checks auth.)
        const sessionKey = new URL(request.url).searchParams.get('sessionKey')
        if (!sessionKey) {
          return new Response(
            JSON.stringify({ error: 'sessionKey query param required' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        await ensureBusStarted()

        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        let keepaliveInterval: ReturnType<typeof setInterval> | null = null

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`,
              ),
            )

            unsubscribe = subscribeToChatEvents((event) => {
              try {
                controller.enqueue(
                  encoder.encode(
                    `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
                  ),
                )
              } catch {
                // Stream closed
              }
            }, sessionKey)

            keepaliveInterval = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: keepalive\n\n`))
              } catch {
                // Stream closed
              }
            }, 15_000)
          },
          cancel() {
            if (unsubscribe) unsubscribe()
            if (keepaliveInterval) clearInterval(keepaliveInterval)
          },
        })

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
