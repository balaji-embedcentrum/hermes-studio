/**
 * ChatPanel — collapsible right-panel chat overlay for non-chat routes.
 * Renders a full ChatScreen in a side panel so users can chat while
 * viewing dashboard, skills, other pages, etc.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowExpand01Icon,
  Cancel01Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import type { SessionMeta } from '@/screens/chat/types'
import { ChatScreen } from '@/screens/chat/chat-screen'
import { useActiveSession } from '@/hooks/use-active-session'
import { chatQueryKeys, clearHistoryMessages, moveHistoryMessages } from '@/screens/chat/chat-queries'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useChatStore } from '@/stores/chat-store'
import { resetPendingSend } from '@/screens/chat/pending-send'
import { Button } from '@/components/ui/button'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const CHAT_PANEL_MIN_WIDTH = 320
const CHAT_PANEL_MAX_WIDTH = 800
const CHAT_PANEL_DEFAULT_WIDTH = 420

export function ChatPanel() {
  const isOpen = useWorkspaceStore((s) => s.chatPanelOpen)
  const sessionKey = useWorkspaceStore((s) => s.chatPanelSessionKey)
  const [panelWidth, setPanelWidth] = useState(CHAT_PANEL_DEFAULT_WIDTH)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(CHAT_PANEL_DEFAULT_WIDTH)
  const setChatPanelOpen = useWorkspaceStore((s) => s.setChatPanelOpen)
  const setChatPanelSessionKey = useWorkspaceStore(
    (s) => s.setChatPanelSessionKey,
  )
  // Counter to force React to re-create ChatScreen on New Chat
  const [chatResetCounter, setChatResetCounter] = useState(0)
  const { hasSession } = useActiveSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Resize drag handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    startX.current = e.clientX
    startWidth.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startX.current - ev.clientX
      const newWidth = Math.min(CHAT_PANEL_MAX_WIDTH, Math.max(CHAT_PANEL_MIN_WIDTH, startWidth.current + delta))
      setPanelWidth(newWidth)
    }
    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [panelWidth])

  // Sync panel width to CSS custom property so workspace-shell can read it for margin
  useEffect(() => {
    if (isOpen) {
      document.documentElement.style.setProperty('--chat-panel-w', `${panelWidth}px`)
    } else {
      document.documentElement.style.removeProperty('--chat-panel-w')
    }
    return () => { document.documentElement.style.removeProperty('--chat-panel-w') }
  }, [isOpen, panelWidth])

  const [forcedSession, setForcedSession] = useState<{
    friendlyId: string
    sessionKey: string
  } | null>(null)

  const isNewChat = sessionKey === 'new' || sessionKey.startsWith('new-')
  const activeFriendlyId = sessionKey || 'main'
  const forcedSessionKey =
    forcedSession?.friendlyId === activeFriendlyId
      ? forcedSession.sessionKey
      : undefined

  // Session list for the dropdown
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessions,
    queryFn: async () => {
      const res = await fetch('/api/sessions')
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data?.sessions)
        ? data.sessions
        : Array.isArray(data)
          ? data
          : []
    },
    staleTime: 10_000,
  })
  const sessions: Array<SessionMeta> = sessionsQuery.data ?? []

  // Current session title
  const activeSession = sessions.find((s) => s.friendlyId === activeFriendlyId)
  const panelTitle = activeSession
    ? activeSession.label ||
      activeSession.title ||
      activeSession.derivedTitle ||
      'Chat'
    : activeFriendlyId === 'main'
      ? 'Main Session'
      : isNewChat
        ? 'New Chat'
        : 'Chat'

  const handleSessionResolved = useCallback(
    (payload: { friendlyId: string; sessionKey: string }) => {
      moveHistoryMessages(
        queryClient,
        'new',
        'new',
        payload.friendlyId,
        payload.sessionKey,
      )
      setForcedSession({
        friendlyId: payload.friendlyId,
        sessionKey: payload.sessionKey,
      })
      setChatPanelSessionKey(payload.friendlyId)
    },
    [queryClient, setChatPanelSessionKey],
  )

  const handleExpand = useCallback(() => {
    setChatPanelOpen(false)
    navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: activeFriendlyId },
    })
  }, [activeFriendlyId, navigate, setChatPanelOpen])

  const handleClose = useCallback(() => {
    setChatPanelOpen(false)
  }, [setChatPanelOpen])

  const handleNewChat = useCallback(() => {
    // Nuclear approach: close panel, clear ALL state, reopen fresh
    setChatPanelOpen(false)

    // 1. Clear React Query caches
    queryClient.removeQueries({ queryKey: ['chat'] })
    queryClient.removeQueries({ queryKey: ['history'] })
    clearHistoryMessages(queryClient, 'new', 'new')

    // 2. Clear Zustand realtime messages and streaming state
    const store = useChatStore.getState()
    store.clearAllStreaming()
    for (const key of store.realtimeMessages.keys()) {
      store.clearSession(key)
    }

    // 3. Clear pending send state
    resetPendingSend()

    // 4. Clear portable chat localStorage + all pending messages
    //    (hermes_pending_msg_* for old sessions; missing this caused the
    //    previous chat's last user bubble to appear at the top of a new chat)
    try {
      const lsKeys: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (!key) continue
        if (
          key === 'hermes_portable_chat_main' ||
          key.startsWith('hermes_pending_msg_') ||
          key.startsWith('hermes_portable_chat_')
        ) {
          lsKeys.push(key)
        }
      }
      for (const key of lsKeys) window.localStorage.removeItem(key)
    } catch {}

    // 5. Clear sessionStorage streaming state
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key?.startsWith('hermes_streaming_')) keysToRemove.push(key)
      }
      for (const key of keysToRemove) sessionStorage.removeItem(key)
    } catch {}

    setForcedSession(null)
    // Use a unique key so React creates a brand new ChatScreen
    const freshKey = `new-${Date.now()}`
    setChatPanelSessionKey(freshKey)
    setChatResetCounter(c => c + 1)
    // Reopen after a tick so React fully unmounts
    setTimeout(() => setChatPanelOpen(true), 100)
  }, [queryClient, setChatPanelSessionKey, setChatPanelOpen])

  const handleSelectSession = useCallback(
    (friendlyId: string) => {
      setForcedSession(null)
      setChatPanelSessionKey(friendlyId)
    },
    [setChatPanelSessionKey],
  )

  // Simple dropdown state
  const [showSessionList, setShowSessionList] = useState(false)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for narrow screens */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/20 z-10 min-[1200px]:hidden"
            onClick={handleClose}
            aria-hidden
          />
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed right-0 bottom-0 top-[var(--titlebar-h,0px)] h-[calc(100dvh-var(--titlebar-h,0px))] max-h-[calc(100dvh-var(--titlebar-h,0px))] max-w-[100vw] border-l overflow-hidden flex flex-col z-20 shadow-xl"
            style={{
              width: panelWidth,
              background: 'var(--theme-bg)',
              borderColor: 'var(--theme-border)',
            }}
          >
            {/* Resize handle — left edge */}
            <div
              onMouseDown={handleResizeStart}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-30 hover:bg-[var(--theme-accent)] transition-colors"
            />
            {/* Panel header */}
            <div className="flex items-center justify-between h-10 px-3 border-b border-primary-200 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowSessionList((v) => !v)}
                  className="text-xs font-medium text-primary-700 hover:text-primary-900 truncate max-w-[200px] transition-colors"
                  title={panelTitle}
                >
                  {panelTitle}
                </button>
              </div>
              <div className="flex items-center gap-0.5">
                <TooltipProvider>
                  <TooltipRoot>
                    <TooltipTrigger
                      onClick={handleNewChat}
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-primary-600 hover:text-primary-900"
                          aria-label="New chat"
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            size={14}
                            strokeWidth={1.5}
                          />
                        </Button>
                      }
                    />
                    <TooltipContent side="bottom">New chat</TooltipContent>
                  </TooltipRoot>
                </TooltipProvider>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={handleClose}
                  className="text-primary-600 hover:text-primary-900"
                  aria-label="Close chat panel"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={14}
                    strokeWidth={1.5}
                  />
                </Button>
              </div>
            </div>

            {/* Session switcher dropdown */}
            <AnimatePresence>
              {showSessionList && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="border-b border-primary-200 overflow-hidden"
                >
                  <div className="max-h-48 overflow-y-auto py-1">
                    {sessions.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => {
                          handleSelectSession(s.friendlyId)
                          setShowSessionList(false)
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                          s.friendlyId === activeFriendlyId
                            ? 'bg-accent-500/10 text-accent-600'
                            : 'text-primary-700 hover:bg-primary-100'
                        }`}
                      >
                        {s.label || s.title || s.derivedTitle || s.friendlyId}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chat content */}
            <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
              <ChatScreen
                key={`${activeFriendlyId}-${chatResetCounter}`}
                activeFriendlyId={activeFriendlyId}
                isNewChat={isNewChat}
                forcedSessionKey={forcedSessionKey}
                onSessionResolved={
                  isNewChat ? handleSessionResolved : undefined
                }
                compact
              />
              {/* Session-ended overlay */}
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
