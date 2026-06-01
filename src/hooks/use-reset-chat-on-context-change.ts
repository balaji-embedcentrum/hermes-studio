/**
 * useResetChatOnContextChange — when the user picks a different project
 * or a different agent session, force the chat back to a fresh "New Chat"
 * view. Without this, the previously-open session (chat/$lastSession) keeps
 * showing the prior agent's / project's conversation when the user returns
 * to /chat, and the side panel keeps streaming the old session into a UI
 * that no longer matches the agent the user just selected.
 *
 * Detection is centralized rather than spread across every selection
 * callsite (projects.tsx has 6+ navigate('/files') calls; agents.tsx has
 * cloud/vps/tunnel/local entry points). We compare current values to
 * last-seen values stored in localStorage so the comparison survives
 * reloads — if the agent session id flipped while the tab was closed,
 * the next mount still resets correctly.
 */
import { useEffect, useRef } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useActiveSession } from '@/hooks/use-active-session'
import { useChatStore } from '@/stores/chat-store'
import { resetPendingSend } from '@/screens/chat/pending-send'

const STORAGE_KEY_WORKSPACE = 'hermes-last-context-workspace'
const STORAGE_KEY_SESSION_ID = 'hermes-last-context-session-id'
const LAST_SESSION_KEY = 'hermes-last-session'

function clearChatRuntimeState() {
  const store = useChatStore.getState()
  store.clearAllStreaming()
  for (const key of store.realtimeMessages.keys()) {
    store.clearSession(key)
  }
  resetPendingSend()
  if (typeof window === 'undefined') return
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (key?.startsWith('hermes_streaming_')) keysToRemove.push(key)
    }
    for (const key of keysToRemove) window.sessionStorage.removeItem(key)
  } catch {
    /* sessionStorage unavailable (private mode) — fine, runtime state is wiped */
  }
  try {
    window.localStorage.removeItem('hermes_portable_chat_main')
  } catch {
    /* same */
  }
}

export function useResetChatOnContextChange() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const setChatPanelSessionKey = useWorkspaceStore(
    (s) => s.setChatPanelSessionKey,
  )
  const chatPanelOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const { session } = useActiveSession()
  const sessionId = session?.sessionId ?? null

  // The latest values held in refs so the effect can read them without
  // re-running for every render — we only want to act when workspace or
  // session id genuinely changes.
  const chatPanelOpenRef = useRef(chatPanelOpen)
  chatPanelOpenRef.current = chatPanelOpen
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  useEffect(() => {
    if (typeof window === 'undefined') return
    let storedWorkspace: string | null = null
    let storedSessionId: string | null = null
    try {
      storedWorkspace = window.localStorage.getItem(STORAGE_KEY_WORKSPACE)
      storedSessionId = window.localStorage.getItem(STORAGE_KEY_SESSION_ID)
    } catch {
      return
    }

    // Skip on the very first mount per device — there's nothing to reset
    // and we'd otherwise force /chat/new on every fresh login.
    const workspaceChanged =
      Boolean(activeWorkspacePath) &&
      storedWorkspace !== null &&
      storedWorkspace !== activeWorkspacePath
    const sessionChanged =
      Boolean(sessionId) &&
      storedSessionId !== null &&
      storedSessionId !== sessionId

    if (workspaceChanged || sessionChanged) {
      clearChatRuntimeState()
      queryClient.removeQueries({ queryKey: ['chat'] })
      queryClient.removeQueries({ queryKey: ['history'] })

      // Reset the "where was the user last?" pointer so the /chat index
      // redirect lands on /chat/new instead of the stale session.
      try {
        window.localStorage.setItem(LAST_SESSION_KEY, 'new')
      } catch {
        /* private mode etc. */
      }

      // If the chat side-panel is open, swap its session to a fresh
      // unique key so React fully unmounts/remounts ChatScreen.
      if (chatPanelOpenRef.current) {
        setChatPanelSessionKey(`new-${Date.now()}`)
      }

      // If currently on /chat/*, hard-redirect to /chat/new. We don't
      // navigate from non-chat routes (e.g. /files) — the user is in
      // the middle of switching projects there; the next chat entry
      // will land on /chat/new via the index redirect above.
      if (pathnameRef.current.startsWith('/chat/')) {
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: 'new' },
          replace: true,
        })
      }
    }

    try {
      if (activeWorkspacePath) {
        window.localStorage.setItem(STORAGE_KEY_WORKSPACE, activeWorkspacePath)
      }
      if (sessionId) {
        window.localStorage.setItem(STORAGE_KEY_SESSION_ID, sessionId)
      }
    } catch {
      /* private mode — we'll just re-detect on next render, no harm done */
    }
  }, [activeWorkspacePath, sessionId, navigate, queryClient, setChatPanelSessionKey])
}
