/**
 * Chat Screen v2 — minimal hand-rolled replacement for the legacy 5000+ line
 * chat module. One messages array as the only source of truth (see
 * useSylangChat). Feature-flagged at /chat-v2/<sessionKey> alongside the
 * legacy /chat route; old chat code stays in place until v2 reaches feature
 * parity, then both routes flip to this implementation.
 */

import {
  
  
  
  
  
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  
  
  
  useSylangChat
} from './runtime/use-sylang-chat'
import { useHistoryHydration } from './hooks/use-history-hydration'
import { SessionsSidebar } from './components/sessions-sidebar'
import { ToolSection } from './components/tool-section'
import {
  saveLocalSessionMessages,
  snippetFromText,
  upsertLocalSession,
} from './runtime/local-sessions'
import type {Attachment, ChatMessage, Part} from './runtime/use-sylang-chat';
import type {ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent} from 'react';
import { Markdown } from '@/components/prompt-kit/markdown'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useActiveSession } from '@/hooks/use-active-session'
import { cn } from '@/lib/utils'

type Props = {
  sessionKey: string
  friendlyId: string
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
  /**
   * When provided, clicking a row in the sessions sidebar (or the
   * "+ New chat" button) calls this instead of routing to
   * /chat/$sessionKey. Used by the right-side ChatPanel to swap the
   * panel's active session in place without leaving the editor.
   */
  onSelectSession?: (sessionKey: string) => void
}

function makeAttachmentId() {
  return `att_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read file as data URL'))
        return
      }
      const contentType = file.type || 'application/octet-stream'
      resolve({
        id: makeAttachmentId(),
        name: file.name || 'attachment',
        contentType,
        size: file.size,
        dataUrl: result,
        isImage: contentType.toLowerCase().startsWith('image/'),
      })
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

// Marker logged once on first mount of ChatScreenV2 in the browser so
// users can confirm in devtools whether the deployed bundle contains
// the latest chat-v2 code (vs. a cached / stale build still serving an
// older index.html). Bump the version string in PRs that change chat-v2.
const CHAT_V2_BUILD_TAG = 'chat-v2 build #60 chat-lock-requires-agent-and-project'
let chatV2BuildLogged = false

export function ChatScreenV2(props: Props) {
  if (!chatV2BuildLogged && typeof window !== 'undefined') {
    chatV2BuildLogged = true
    console.log(`[${CHAT_V2_BUILD_TAG}] mounted`)
  }

  // Sessions sidebar is hidden by default — it crowds the chat especially
  // when chat-v2 is mounted inside the narrow right-side ChatPanel.
  // Toggle via the header button to bring it in.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Pull the active project's workspace path from the workspace store.
  // Server's /api/send-stream uses this to build the "CURRENT PROJECT /
  // PROJECT ROOT" system-message block — without it the agent never gets
  // told which project it's looking at and falls back to /app (the
  // Dockerfile WORKDIR). Falls back to whatever the caller passed in via
  // props for backwards compat / explicit overrides.
  const storeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const storeLocalAgentUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const storeLocalWorkspaceRoot = useWorkspaceStore(
    (s) => s.localWorkspaceRoot,
  )
  const resolvedProps: Props = {
    ...props,
    workspacePath: props.workspacePath || storeWorkspacePath || undefined,
    localAgentUrl: props.localAgentUrl || storeLocalAgentUrl || undefined,
    localWorkspaceRoot:
      props.localWorkspaceRoot || storeLocalWorkspaceRoot || undefined,
  }

  // Fetch /api/history BEFORE mounting the chat hook so its initial state
  // already has the previous turns. Avoids the double-render flash you'd
  // get if we seeded via a post-mount effect.
  const hydration = useHistoryHydration(props.sessionKey)

  if (hydration.status === 'loading') {
    return (
      <div className="flex h-full min-h-0">
        {sidebarOpen && (
          <SessionsSidebar
            currentSessionKey={props.sessionKey}
            onPick={() => setSidebarOpen(false)}
            onSelectSession={props.onSelectSession}
          />
        )}
        <div className="flex flex-1 items-center justify-center text-sm text-primary-400">
          Loading conversation…
        </div>
      </div>
    )
  }

  // Hard error fetching history — show it but still let the user start
  // a new conversation (they can recover by sending a message; the agent
  // session can be rebuilt from scratch).
  const initialMessages =
    hydration.status === 'ready' ? hydration.messages : []
  const hydrationError =
    hydration.status === 'error' ? hydration.error : null

  // key={sessionKey} forces a clean useSylangChat remount when the
  // session changes via the sessions sidebar — fresh state, fresh
  // history-hydrated initial messages, no leakage from the previous
  // thread.
  return (
    <div className="flex h-full min-h-0">
      {sidebarOpen && (
        <SessionsSidebar
          currentSessionKey={props.sessionKey}
          onPick={() => setSidebarOpen(false)}
          onSelectSession={props.onSelectSession}
        />
      )}
      <div className="min-w-0 flex-1">
        <ChatScreenV2Inner
          key={props.sessionKey}
          {...resolvedProps}
          initialMessages={initialMessages}
          hydrationError={hydrationError}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
      </div>
    </div>
  )
}

type InnerProps = Props & {
  initialMessages: Array<ChatMessage>
  hydrationError: string | null
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

function ChatScreenV2Inner({
  sessionKey,
  friendlyId,
  workspacePath,
  localAgentUrl,
  localWorkspaceRoot,
  initialMessages,
  hydrationError,
  sidebarOpen,
  onToggleSidebar,
}: InnerProps) {
  const { messages, status, error, send, stop } = useSylangChat({
    sessionKey,
    friendlyId,
    workspacePath,
    localAgentUrl,
    localWorkspaceRoot,
    initialMessages,
  })
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<Attachment>
  >([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const isBusy = status === 'sending' || status === 'streaming'

  // Lock the chat until the user has BOTH:
  //   • an active agent session (or a local-agent URL), AND
  //   • a project selected (workspacePath).
  //
  // Treat the initial probe (hasSession === null) as "no agent yet" so
  // the composer stays locked through the first roundtrip — a stray click
  // landing before the probe resolves would otherwise sneak through.
  // useActiveSession re-probes on mount + focus + realtime / storage, so
  // the lock clears within a frame of the session actually being claimed.
  const { hasSession } = useActiveSession()
  const noActiveSession = !localAgentUrl && hasSession !== true
  const noWorkspace = !workspacePath
  const composerDisabled = isBusy || noActiveSession || noWorkspace
  const navigate = useNavigate()

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Mirror this session into the browser-local sidebar index. We derive the
  // label from the FIRST user message text (so the sidebar reads like the
  // user's actual prompts) and update lastSnippet from the most recent text
  // message regardless of role. Runs on every messages change but the upsert
  // is cheap and the writer dedupes equal updates downstream.
  useEffect(() => {
    if (messages.length === 0) return
    const firstUserText = (() => {
      for (const m of messages) {
        if (m.role !== 'user') continue
        const t = m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (t.trim()) return t
      }
      return ''
    })()
    const latestText = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        const t = m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (t.trim()) return t
      }
      return ''
    })()
    upsertLocalSession({
      key: sessionKey,
      label: firstUserText ? snippetFromText(firstUserText, 60) : undefined,
      lastSnippet: latestText ? snippetFromText(latestText, 90) : null,
    })
    // Persist the full transcript too — the fleet's agent has no
    // /api/sessions/<id>/messages endpoint, so without this the chat
    // can never be re-loaded after a panel close/reopen or a click
    // back to an older session row. See local-sessions.ts for the
    // storage shape (and why dataUrl is stripped on persist).
    saveLocalSessionMessages(sessionKey, messages)
  }, [messages, sessionKey])

  const ingestFiles = useCallback(async (files: Array<File> | FileList) => {
    setAttachmentError(null)
    const list = Array.from(files)
    if (list.length === 0) return
    try {
      const next = await Promise.all(list.map(fileToAttachment))
      setPendingAttachments((prev) => [...prev, ...next])
    } catch (err) {
      setAttachmentError(
        err instanceof Error ? err.message : 'Could not attach file',
      )
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) return
    if (noActiveSession) return
    const value = input
    const attachments = pendingAttachments
    if (!value.trim() && attachments.length === 0) return
    setInput('')
    setPendingAttachments([])
    void send(value, attachments)
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      ;(event.currentTarget.form)?.requestSubmit()
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return
    void ingestFiles(event.target.files)
    // Allow re-selecting the same file later
    event.target.value = ''
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData.items
    const files: Array<File> = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      void ingestFiles(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    if (event.dataTransfer.files.length === 0) return
    void ingestFiles(event.dataTransfer.files)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = () => setIsDraggingOver(false)

  const removeAttachment = (id: string) =>
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-primary-50/40 dark:bg-primary-950/40"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-500/10 ring-2 ring-inset ring-accent-500">
          <div className="rounded-lg bg-white px-4 py-2 text-sm text-accent-700 shadow-md dark:bg-primary-900 dark:text-accent-300">
            Drop files to attach
          </div>
        </div>
      )}
      {/* Slim header: sessions toggle only. The studio shell already has
       *  its own chat title bar above us, so this stays minimal. */}
      <div className="flex items-center justify-between border-b border-primary-200/70 bg-white px-2 py-1 dark:border-primary-800/70 dark:bg-primary-950">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded px-2 py-1 text-xs text-primary-600 hover:bg-primary-100 hover:text-primary-900 dark:text-primary-400 dark:hover:bg-primary-800 dark:hover:text-primary-100"
          aria-label={sidebarOpen ? 'Hide chat history' : 'Show chat history'}
          title={sidebarOpen ? 'Hide chat history' : 'Show chat history'}
        >
          {sidebarOpen ? '‹ Hide' : '☰ Chats'}
        </button>
      </div>
      {(error || attachmentError || hydrationError) && (
        <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="min-w-0 flex-1">
            {error ?? attachmentError ?? `Couldn't load history: ${hydrationError}`}
          </span>
          {error && (
            <button
              type="button"
              onClick={() => {
                // Find the last user message and drop its text back into the
                // composer so the user can edit + retry. We don't auto-resend
                // because the original send might have included attachments
                // we no longer have in memory.
                for (let i = messages.length - 1; i >= 0; i--) {
                  const msg = messages[i]
                  if (msg.role !== 'user') continue
                  const text = msg.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { text: string }).text)
                    .join('')
                  if (text) {
                    setInput(text)
                    inputRef.current?.focus()
                  }
                  break
                }
              }}
              className="flex-none rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60"
            >
              Retry last
            </button>
          )}
        </div>
      )}
      <div ref={viewportRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>
      {(noActiveSession || noWorkspace) && (
        <ChatLockBanner
          noActiveSession={noActiveSession}
          noWorkspace={noWorkspace}
          onPickAgent={() => navigate({ to: '/agents' })}
          onPickProject={() => navigate({ to: '/projects' })}
        />
      )}
      <form
        onSubmit={handleSubmit}
        className="border-t border-primary-200 bg-white px-3 py-3 dark:border-primary-800 dark:bg-primary-950"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  attachment={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={composerDisabled}
              className="rounded-lg border border-primary-200 bg-white p-2 text-primary-600 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-300 dark:hover:bg-primary-800"
              aria-label="Attach files"
              title={
                noActiveSession && noWorkspace
                  ? 'Pick an agent and a project first'
                  : noActiveSession
                    ? 'Select an agent first'
                    : noWorkspace
                      ? 'Select a project first'
                      : 'Attach files'
              }
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFileInputChange}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              autoFocus={!composerDisabled}
              disabled={composerDisabled}
              placeholder={
                noActiveSession && noWorkspace
                  ? '🔒  Pick an agent and a project to start chatting'
                  : noActiveSession
                    ? '🔒  Select an agent on /agents to start chatting'
                    : noWorkspace
                      ? '🔒  Select a project on /projects to start chatting'
                      : 'Message the agent… (paste / drop files to attach)'
              }
              className="flex-1 resize-none rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-950 placeholder:text-primary-400 focus:border-primary-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-primary-100/50 disabled:text-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-50 dark:placeholder:text-primary-500 dark:focus:border-primary-500 dark:disabled:bg-primary-900/50 dark:disabled:text-primary-400"
            />
            {isBusy ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-primary-700 hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-200 dark:hover:bg-primary-800"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  composerDisabled ||
                  (!input.trim() && pendingAttachments.length === 0)
                }
                className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-center text-primary-500 dark:text-primary-400">
      <div>
        <div className="mb-2 text-3xl">💬</div>
        <div className="text-sm">Send a message to start the chat.</div>
        <div className="mt-1 text-[11px] text-primary-400 dark:text-primary-500">
          This is chat-v2 (rewritten with single source of truth).
        </div>
      </div>
    </div>
  )
}

/**
 * Banner shown above the composer when the chat is locked because either
 * (or both of) the agent and project haven't been picked yet. Clicking
 * the action button routes the user to the page that fixes the gap; the
 * lock clears automatically when useActiveSession / the workspace store
 * see the new state.
 */
function ChatLockBanner({
  noActiveSession,
  noWorkspace,
  onPickAgent,
  onPickProject,
}: {
  noActiveSession: boolean
  noWorkspace: boolean
  onPickAgent: () => void
  onPickProject: () => void
}) {
  // When both gaps exist, surface the agent step first — picking a project
  // is meaningless without an agent to run against. After they claim an
  // agent the banner re-renders with just the project ask.
  const message = noActiveSession
    ? noWorkspace
      ? 'Pick an agent and a project to start chatting.'
      : 'Chat is locked until you pick an agent.'
    : 'Chat is locked until you select a project.'
  const headline = noActiveSession
    ? noWorkspace
      ? 'No agent or project selected.'
      : 'No agent selected.'
    : 'No project selected.'
  const action = noActiveSession
    ? { label: 'Pick an agent →', onClick: onPickAgent }
    : { label: 'Pick a project →', onClick: onPickProject }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="flex items-center gap-2">
        <span aria-hidden="true">🔒</span>
        <span>
          <strong>{headline}</strong> {message}
        </span>
      </span>
      <button
        type="button"
        onClick={action.onClick}
        className="flex-none rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60"
      >
        {action.label}
      </button>
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 py-1 pl-1 pr-2 dark:border-primary-700 dark:bg-primary-900">
      {attachment.isImage ? (
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-white text-base dark:bg-primary-800">
          📄
        </div>
      )}
      <div className="text-xs">
        <div className="max-w-[140px] truncate text-primary-800 dark:text-primary-100">
          {attachment.name}
        </div>
        <div className="text-primary-500 dark:text-primary-400">
          {formatBytes(attachment.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-800 dark:text-primary-400 dark:hover:bg-primary-800 dark:hover:text-primary-100"
        aria-label="Remove attachment"
      >
        ×
      </button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Pull out every plain-text fragment of a message — used for the copy button
 * so the clipboard gets the user's prompt / the assistant's reply, not the
 * tool / reasoning chrome around it.
 */
function messagePlainText(message: ChatMessage): string {
  const out: Array<string> = []
  for (const p of message.parts) {
    if (p.type === 'text' && p.text) out.push(p.text)
  }
  return out.join('\n\n').trim()
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])
  const handleClick = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard can fail in non-secure contexts — silent
    }
  }
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={!text}
      className={cn(
        'rounded p-1 text-[11px] leading-none transition-colors',
        'text-primary-400 opacity-0 hover:bg-primary-100 hover:text-primary-700 group-hover:opacity-100',
        'dark:text-primary-500 dark:hover:bg-primary-800 dark:hover:text-primary-200',
        copied && 'text-emerald-600 opacity-100 dark:text-emerald-400',
      )}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  // "Waiting" = streaming assistant whose bubble has no rendered content yet
  // (no visible text, no tool card, no reasoning). Used to switch the bubble
  // into a "Thinking…" pulse instead of just showing an empty card.
  const hasRenderableContent = message.parts.some((p) => {
    if (p.type === 'tool') return true
    if (p.type === 'reasoning' && p.text.trim()) return true
    if (p.type === 'text' && p.text.trim()) return true
    return false
  })
  const isWaiting =
    message.role === 'assistant' &&
    Boolean(message.streaming) &&
    !hasRenderableContent
  // Show the small pulse dot when streaming has already started painting
  // text — confirms the stream is alive but doesn't crowd the bubble.
  const showInlinePulse =
    message.role === 'assistant' &&
    Boolean(message.streaming) &&
    hasRenderableContent

  const copyText = messagePlainText(message)
  // Don't show the copy button on the still-streaming assistant bubble —
  // copying partial output is rarely what the user wants. It re-appears as
  // soon as streaming finishes.
  const showCopyButton = copyText.length > 0 && !message.streaming

  return (
    <div
      className={cn(
        'group flex items-end gap-2',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && <AssistantAvatar />}
      {isUser && showCopyButton && (
        <div className="flex flex-col self-end">
          <CopyButton text={copyText} />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
          isUser
            ? 'bg-primary-200/80 text-primary-950 dark:bg-primary-800 dark:text-primary-50'
            : 'rounded-bl-sm bg-white text-primary-950 ring-1 ring-primary-100 dark:bg-primary-900 dark:text-primary-50 dark:ring-primary-700',
        )}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {isWaiting ? (
          <ThinkingPulse />
        ) : (
          message.parts.map((part, idx) => (
            <PartRenderer key={idx} part={part} />
          ))
        )}
        {showInlinePulse && (
          <div className="mt-1 inline-flex h-2 w-2 animate-pulse rounded-full bg-primary-400" />
        )}
      </div>
      {!isUser && showCopyButton && (
        <div className="flex flex-col self-end">
          <CopyButton text={copyText} />
        </div>
      )}
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div
      className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white p-0.5 shadow-sm ring-1 ring-primary-200 dark:bg-primary-900 dark:ring-primary-700"
      aria-label="Sylang agent"
      title="Sylang agent"
    >
      <img
        src="/sylang-logo.svg"
        alt=""
        className="h-full w-full object-contain"
      />
    </div>
  )
}

/**
 * Three bouncing dots + a "Thinking… <elapsed>s" label. Used as the body of
 * an assistant bubble while we're still waiting for the first delta / tool
 * event to arrive. Self-contained — owns its own elapsed-time interval so it
 * resets cleanly whenever the parent re-mounts it.
 */
function ThinkingPulse() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const label =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-400" />
      </span>
      <span className="text-xs font-medium text-primary-500 dark:text-primary-300">Thinking…</span>
      {elapsed > 0 && (
        <span className="text-[10px] tabular-nums text-primary-400 dark:text-primary-500">
          {label}
        </span>
      )}
    </div>
  )
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.isImage) {
    return (
      <a
        href={attachment.dataUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="max-h-48 rounded-lg object-cover"
        />
      </a>
    )
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-white/60 px-2 py-1 text-xs text-primary-800 ring-1 ring-primary-200 dark:bg-primary-900/60 dark:text-primary-100 dark:ring-primary-700">
      <span>📄</span>
      <span className="max-w-[160px] truncate">{attachment.name}</span>
      <span className="text-primary-500 dark:text-primary-400">{formatBytes(attachment.size)}</span>
    </div>
  )
}

function PartRenderer({ part }: { part: Part }) {
  if (part.type === 'text') {
    if (!part.text) return null
    return (
      <div className="leading-relaxed">
        <Markdown>{part.text}</Markdown>
      </div>
    )
  }
  if (part.type === 'reasoning') {
    if (!part.text) return null
    const preview = part.text.split('\n')[0].trim()
    const short = preview.length > 80 ? `${preview.slice(0, 77)}…` : preview
    return (
      <details className="mb-2 rounded border border-primary-200/60 bg-primary-50/40 text-xs dark:border-primary-700/60 dark:bg-primary-900/40">
        <summary className="flex cursor-pointer items-baseline gap-2 px-2 py-1.5 text-primary-700 hover:bg-primary-100/60 dark:text-primary-200 dark:hover:bg-primary-800/60">
          <span className="font-mono text-sm">💭</span>
          <span className="font-medium">Thinking</span>
          {short && (
            <span className="truncate text-primary-500 dark:text-primary-400">{short}</span>
          )}
        </summary>
        <div className="border-t border-primary-200/50 px-2 py-2 dark:border-primary-700/50">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-1.5 font-sans text-[11px] leading-snug text-primary-700 ring-1 ring-primary-200/40 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-700/40">
            {part.text}
          </pre>
        </div>
      </details>
    )
  }
  // tool part — delegate to the proper TUI-style card
  return <ToolSection tool={part} />
}
