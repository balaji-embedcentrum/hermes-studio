import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { moveHistoryMessages } from '../../screens/chat/chat-queries'
import { resetPendingSend } from '../../screens/chat/pending-send'
import { useChatStore } from '@/stores/chat-store'
import { ErrorBoundary } from '@/components/error-boundary'
import { useActiveSession } from '@/hooks/use-active-session'

const ChatScreen = lazy(async () => {
  const module = await import('../../screens/chat/chat-screen')
  return { default: module.ChatScreen }
})

export const Route = createFileRoute('/chat/$sessionKey')({
  component: ChatRoute,
  // Disable SSR to prevent hydration mismatches from async data
  ssr: false,
  errorComponent: function ChatError({ error, reset }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-primary-50">
        <div className="max-w-md">
          <div className="mb-4 text-5xl">💬</div>
          <h2 className="text-xl font-semibold text-primary-900 mb-3">
            Chat Error
          </h2>
          <p className="text-sm text-primary-600 mb-6">
            {error instanceof Error
              ? error.message
              : 'Failed to load chat session'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined')
                  window.location.href = '/chat'
              }}
              className="px-4 py-2 border border-primary-300 text-primary-700 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Return to Main
            </button>
          </div>
        </div>
      </div>
    )
  },
})

function ChatRoute() {
  // Client-only rendering to prevent hydration mismatches
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const queryClient = useQueryClient()
  const { hasSession } = useActiveSession()
  const navigate = useNavigate()

  // When there's no active session (just-ended, idle-reclaimed, or
  // first visit), bounce the user to /agents instead of stranding
  // them on a dead chat page. The lock overlay is kept as a fallback
  // for the brief moment between hasSession flipping false and the
  // navigation taking effect.
  useEffect(() => {
    if (hasSession === false) {
      navigate({ to: '/agents', replace: true })
    }
  }, [hasSession, navigate])
  const [forcedSession, setForcedSession] = useState<{
    friendlyId: string
    sessionKey: string
  } | null>(null)
  const params = Route.useParams()
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'
  const isNewChat = activeFriendlyId === 'new'
  const forcedSessionKey =
    forcedSession?.friendlyId === activeFriendlyId
      ? forcedSession.sessionKey
      : undefined

  // Fully reset all chat state when navigating to new chat
  useEffect(() => {
    if (!isNewChat) return

    // Clear React Query caches (history, sessions, etc.)
    queryClient.removeQueries({ queryKey: ['chat'] })
    queryClient.removeQueries({ queryKey: ['history'] })

    // Clear Zustand realtime messages and streaming state
    const store = useChatStore.getState()
    store.clearAllStreaming()
    // Clear all realtime message buffers
    for (const key of store.realtimeMessages.keys()) {
      store.clearSession(key)
    }

    // Clear pending send state
    resetPendingSend()

    // Clear portable chat localStorage
    try { window.localStorage.removeItem('hermes_portable_chat_main') } catch {}

    // Clear any persisted streaming state from sessionStorage
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key?.startsWith('hermes_streaming_')) keysToRemove.push(key)
      }
      for (const key of keysToRemove) sessionStorage.removeItem(key)
    } catch {}
  }, [isNewChat, queryClient])

  const handleSessionResolved = useCallback(
    function handleSessionResolved(payload: {
      friendlyId: string
      sessionKey: string
    }) {
      const sourceFriendlyId = activeFriendlyId
      const sourceSessionKey = forcedSessionKey ?? activeFriendlyId
      moveHistoryMessages(
        queryClient,
        sourceFriendlyId,
        sourceSessionKey,
        payload.friendlyId,
        payload.sessionKey,
      )
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      setForcedSession({
        friendlyId: payload.friendlyId,
        sessionKey: payload.sessionKey,
      })
      // Persist last session for refresh recovery
      try {
        localStorage.setItem('hermes-last-session', payload.friendlyId)
      } catch {}
      navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: payload.friendlyId },
        replace: true,
      })
    },
    [activeFriendlyId, forcedSessionKey, navigate, queryClient],
  )

  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center text-primary-400">
        Loading chat…
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-primary-400">
            Loading chat…
          </div>
        }
      >
        <div className="relative h-full min-h-0">
          <ChatScreen
            activeFriendlyId={activeFriendlyId}
            isNewChat={isNewChat}
            forcedSessionKey={forcedSessionKey}
            onSessionResolved={
              isNewChat || activeFriendlyId === 'main'
                ? handleSessionResolved
                : undefined
            }
          />
          {hasSession === false && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center backdrop-blur-sm z-10"
              style={{ background: 'rgba(0,0,0,0.6)' }}
            >
              <div className="text-5xl">🔒</div>
              <div>
                <div className="text-base font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>
                  No active session
                </div>
                <div className="text-sm max-w-xs" style={{ color: 'var(--theme-muted)' }}>
                  Select an agent to start a new session before chatting.
                </div>
              </div>
              <button
                onClick={() => { window.location.href = '/agents' }}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--theme-accent)', color: '#fff' }}
              >
                Go to Agents
              </button>
            </div>
          )}
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}
