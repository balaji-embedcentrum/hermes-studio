/**
 * Route /chat/$sessionKey — now serves the rewritten ChatScreenV2.
 *
 * The legacy ChatScreen in src/screens/chat/ remains in the repo for now
 * (deleted in the final cleanup commit) but is no longer reachable through
 * routing. All chat traffic — including the post-login redirect — lands on
 * the new minimal single-source-of-truth chat.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ChatScreenV2 } from '../../screens/chat-v2/chat-screen-v2'
import { ErrorBoundary } from '@/components/error-boundary'
import { useActiveSession } from '@/hooks/use-active-session'

export const Route = createFileRoute('/chat/$sessionKey')({
  component: ChatRoute,
  errorComponent: function ChatError({ error, reset }) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-primary-50 p-6 text-center">
        <div className="max-w-md">
          <div className="mb-4 text-5xl">💬</div>
          <h2 className="mb-3 text-xl font-semibold text-primary-900">
            Chat Error
          </h2>
          <p className="mb-6 text-sm text-primary-600">
            {error instanceof Error
              ? error.message
              : 'Failed to load chat session'}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-lg bg-accent-500 px-4 py-2 text-white transition-colors hover:bg-accent-600"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  },
})

function ChatRoute() {
  const { hasSession } = useActiveSession()
  const navigate = useNavigate()
  const params = Route.useParams()
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'

  // If the user has no active agent session, bounce to /agents instead of
  // landing on a chat that can't actually talk to anything. Matches the
  // behavior of the legacy /chat route.
  useEffect(() => {
    if (hasSession === false) {
      navigate({ to: '/agents', replace: true })
    }
  }, [hasSession, navigate])

  return (
    <ErrorBoundary>
      <div className="h-full min-h-0">
        <ChatScreenV2
          sessionKey={activeFriendlyId}
          friendlyId={activeFriendlyId}
        />
      </div>
    </ErrorBoundary>
  )
}
