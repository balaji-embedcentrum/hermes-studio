/**
 * Sessions sidebar for chat-v2 — reads from BROWSER localStorage instead of
 * the agent's session list.
 *
 * Rationale: hermes-adapter agent containers hold their own session DB.
 * `fleet up` / container rebuilds wipe that DB, which makes /api/sessions
 * silently empty and leaves the user with no record of past conversations.
 * The browser-local index in `local-sessions.ts` survives container churn,
 * which is what the user actually wants here.
 *
 * History (the messages themselves) is still fetched on demand from
 * /api/history when you open a session, so this is purely the index.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type {LocalSession} from '@/screens/chat-v2/runtime/local-sessions';
import {

  deleteLocalSession,
  listLocalSessions,
  listLocalSessionsServerSnapshot,
  subscribeLocalSessions
} from '@/screens/chat-v2/runtime/local-sessions'
import { chatQueryKeys } from '@/screens/chat/chat-queries'
import { cn } from '@/lib/utils'

type Props = {
  currentSessionKey: string
  /** Optional callback fired after navigation / action, useful for closing
   *  the sidebar after the user picks a session. */
  onPick?: () => void
  /**
   * When provided, picking a session (or starting a new chat) calls this
   * instead of routing to /chat/$sessionKey. ChatPanel uses it to swap
   * the panel's active session without leaving the current editor view.
   */
  onSelectSession?: (sessionKey: string) => void
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return new Date(ms).toLocaleDateString()
}

function useLocalSessions(): ReadonlyArray<LocalSession> {
  // Snapshot getters MUST return a stable reference between writes — see
  // the comment in local-sessions.ts. Both `listLocalSessions` (client) and
  // `listLocalSessionsServerSnapshot` (SSR) honor that contract.
  return useSyncExternalStore(
    subscribeLocalSessions,
    listLocalSessions,
    listLocalSessionsServerSnapshot,
  )
}

export function SessionsSidebar({
  currentSessionKey,
  onPick,
  onSelectSession,
}: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessions = useLocalSessions()

  // When onSelectSession is provided, swap the session in place (panel
  // context). Otherwise route to /chat/$sessionKey (dedicated route).
  const goTo = useCallback(
    (sessionKey: string) => {
      if (onSelectSession) {
        onSelectSession(sessionKey)
      } else {
        void navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey },
        })
      }
      onPick?.()
    },
    [navigate, onPick, onSelectSession],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent, sessionKey: string) => {
      e.stopPropagation()
      e.preventDefault()
      deleteLocalSession(sessionKey)
      // Drop any cached history for this session so a future visit refetches
      // (or starts blank if the agent doesn't have it either).
      queryClient.removeQueries({
        queryKey: ['chat', 'history', sessionKey],
        exact: false,
      })
      if (sessionKey === currentSessionKey) {
        // We just deleted the open session — bounce to a fresh one.
        const fresh = `s_${Date.now().toString(36)}`
        if (onSelectSession) {
          onSelectSession(fresh)
        } else {
          void navigate({
            to: '/chat/$sessionKey',
            params: { sessionKey: fresh },
          })
        }
      }
    },
    [currentSessionKey, navigate, onSelectSession, queryClient],
  )

  const handleNewChat = useCallback(() => {
    // Generate a fresh sessionKey rather than hardcoding "new" — that way every
    // new chat is a distinct row in the sidebar instead of overwriting one.
    const fresh = `s_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`
    // Bust any stale history cache under this (unlikely-to-collide) key.
    queryClient.removeQueries({
      queryKey: chatQueryKeys.history(fresh, fresh),
      exact: true,
    })
    goTo(fresh)
  }, [goTo, queryClient])

  return (
    <aside className="flex h-full w-64 flex-none flex-col border-r cv2-border cv2-panel">
      <div className="border-b cv2-border p-2">
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-600"
        >
          + New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {sessions.length === 0 ? (
          <div className="p-3 text-xs cv2-muted">
            No chats yet — send a message to start one.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const active = session.key === currentSessionKey
              return (
                <li key={session.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => goTo(session.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goTo(session.key)
                      }
                    }}
                    className={cn(
                      'group flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      active
                        ? 'cv2-active'
                        : 'cv2-text cv2-hover',
                    )}
                  >
                    <div className="flex w-full items-baseline justify-between gap-2">
                      <span className="truncate font-medium">
                        {session.label}
                      </span>
                      <div className="flex flex-none items-center gap-1">
                        <span className="text-[10px] cv2-muted">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, session.key)}
                          aria-label={`Delete chat ${session.label}`}
                          title="Remove from sidebar"
                          className="rounded p-0.5 cv2-muted opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {session.lastSnippet && (
                      <span className="line-clamp-1 w-full text-xs cv2-muted">
                        {session.lastSnippet}
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="border-t cv2-border px-2 py-1 text-[10px] cv2-muted">
        Stored locally in this browser.
      </div>
    </aside>
  )
}
