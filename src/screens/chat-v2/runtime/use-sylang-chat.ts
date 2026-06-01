/**
 * Sylang chat — hand-rolled minimal alternative to the legacy chat module's
 * 4-state-source / 6-anti-flicker-hack mesh. ONE messages array is the only
 * source of truth. As SSE events arrive, we update the LAST assistant message
 * in that array in place. No mirror caches, no streaming-state map, no
 * completed-text refs, no sticky-text refs, no per-runId dedup layers.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  streamAgentEvents,
  type AgentEvent,
  type ChatAttachmentPayload,
} from './sse-client'

export type Attachment = {
  id: string
  name: string
  contentType: string
  size: number
  /** data:<mime>;base64,<...> — what the server expects in the dataUrl field */
  dataUrl: string
  /** Is this an image we should preview inline in the user bubble? */
  isImage: boolean
}

export type ChatRole = 'user' | 'assistant'

export type ToolPart = {
  type: 'tool'
  id: string
  name: string
  phase: 'start' | 'running' | 'complete' | 'error'
  args?: unknown
  preview?: string
  result?: unknown
}

export type TextPart = { type: 'text'; text: string }
export type ReasoningPart = { type: 'reasoning'; text: string }
export type Part = TextPart | ReasoningPart | ToolPart

export type ChatMessage = {
  id: string
  role: ChatRole
  parts: Array<Part>
  attachments?: Array<Attachment>
  /** true while the assistant message is still streaming */
  streaming?: boolean
  /** wall-clock when the message was first added to the list */
  createdAt: number
}

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error'

function makeId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function decodeBase64Utf8(b64: string): string {
  // atob → binary string → bytes → UTF-8 decode. Plain atob produces
  // garbled output for any non-ASCII content, which trips up agents
  // reading source files with comments / non-Latin characters.
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}

/**
 * Build a string to APPEND to the user's message text containing the
 * decoded contents of every non-image attachment, wrapped in
 * <attachment name="..."> blocks. The agent reads these as part of the
 * user prompt — matches what the legacy chat used to do (see
 * chat-screen.tsx textBlocks construction). Image attachments still
 * travel as multimodal image_url parts via the SSE payload.
 */
function buildTextAttachmentSuffix(attachments: Array<Attachment>): string {
  const blocks: Array<string> = []
  for (const a of attachments) {
    if (isImageMime(a.contentType)) continue
    const dataUrl = a.dataUrl || ''
    let content = ''
    if (dataUrl.startsWith('data:') && dataUrl.includes(',')) {
      const b64 = dataUrl.split(',')[1] || ''
      content = decodeBase64Utf8(b64)
    }
    if (!content) continue
    blocks.push(`\n\n<attachment name="${a.name || 'file'}">\n${content}\n</attachment>`)
  }
  return blocks.join('')
}

type Options = {
  sessionKey: string
  friendlyId: string
  initialMessages?: Array<ChatMessage>
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
}

export function useSylangChat(options: Options) {
  const [messages, setMessages] = useState<Array<ChatMessage>>(
    options.initialMessages ?? [],
  )
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const updateAssistant = useCallback(
    (assistantId: string, updater: (msg: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? updater(m) : m)),
      )
    },
    [],
  )

  const applyEvent = useCallback(
    (assistantId: string, event: AgentEvent) => {
      switch (event.type) {
        case 'chunk': {
          const incoming = String(event.data.text ?? '')
          // The server emits TWO shapes of chunk events:
          //   • assistant.delta     → { text: <delta> }                  (append)
          //   • assistant.completed → { text: <full>, fullReplace: true } (replace)
          // Default MUST be append when fullReplace is absent — otherwise
          // every delta wipes the bubble and you only see the final
          // assistant.completed text at the end (no streaming feel).
          const fullReplace = event.data.fullReplace === true
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const hasParts = parts.length > 0
            const lastIdx = parts.length - 1
            const lastIsText = hasParts && parts[lastIdx].type === 'text'
            if (fullReplace) {
              // assistant.completed is a fallback that arrives AFTER the
              // delta stream has finished. If tools were emitted in
              // between, the text is already split across multiple text
              // parts in chronological order — overwriting the last one
              // with the full accumulated text would duplicate pre-tool
              // content. Skip the replace in that case; the deltas
              // already painted everything. Only honor fullReplace when
              // the bubble has a single text segment (no interleaved
              // tools), which is the typical short-reply path.
              const hasTool = parts.some((p) => p.type === 'tool')
              if (hasTool) return m
              if (lastIsText) {
                parts[lastIdx] = { type: 'text', text: incoming }
              } else {
                parts.push({ type: 'text', text: incoming })
              }
            } else if (lastIsText) {
              const prev = parts[lastIdx] as TextPart
              parts[lastIdx] = { type: 'text', text: prev.text + incoming }
            } else {
              parts.push({ type: 'text', text: incoming })
            }
            return { ...m, parts }
          })
          break
        }
        case 'thinking': {
          const incoming = String(event.data.text ?? '')
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const existingIdx = parts.findIndex((p) => p.type === 'reasoning')
            if (existingIdx >= 0) {
              parts[existingIdx] = { type: 'reasoning', text: incoming }
            } else {
              parts.unshift({ type: 'reasoning', text: incoming })
            }
            return { ...m, parts }
          })
          break
        }
        case 'tool': {
          const id = String(event.data.toolCallId ?? `tool_${makeId()}`)
          const name = String(event.data.name ?? 'tool')
          const phaseRaw = String(event.data.phase ?? 'running')
          const phase = (
            phaseRaw === 'complete' || phaseRaw === 'completed'
              ? 'complete'
              : phaseRaw === 'error'
                ? 'error'
                : phaseRaw === 'start'
                  ? 'start'
                  : 'running'
          ) as ToolPart['phase']
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const existingIdx = parts.findIndex(
              (p) => p.type === 'tool' && p.id === id,
            )
            const next: ToolPart = {
              type: 'tool',
              id,
              name,
              phase,
              args: event.data.args,
              preview:
                typeof event.data.preview === 'string'
                  ? event.data.preview
                  : undefined,
              result: event.data.result,
            }
            if (existingIdx >= 0) {
              parts[existingIdx] = { ...parts[existingIdx], ...next }
            } else {
              parts.push(next)
            }
            return { ...m, parts }
          })
          break
        }
        case 'error': {
          setError(String(event.data.message ?? 'Agent error'))
          break
        }
        default:
          break
      }
    },
    [updateAssistant],
  )

  const send = useCallback(
    async (text: string, attachments?: Array<Attachment>) => {
      const trimmed = text.trim()
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0
      if (!trimmed && !hasAttachments) return
      if (status === 'sending' || status === 'streaming') return

      setError(null)
      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        parts: trimmed ? [{ type: 'text', text: trimmed }] : [],
        attachments: hasAttachments ? attachments : undefined,
        createdAt: Date.now(),
      }
      const assistantId = makeId()
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        streaming: true,
        createdAt: Date.now() + 1,
      }
      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setStatus('sending')

      const abort = new AbortController()
      abortRef.current?.abort()
      abortRef.current = abort

      try {
        // Server-side buildMultimodalContent in send-stream.ts only
        // routes IMAGE attachments to the agent (as multimodal
        // image_url parts); text / markdown / source files are
        // silently dropped. Legacy chat worked around this by
        // inlining text-file content into the user message body as
        // <attachment name="..."> XML blocks. Same here so README.md,
        // .ts, .sylang etc. attachments actually reach the LLM.
        const enrichedMessage = hasAttachments
          ? trimmed + buildTextAttachmentSuffix(attachments)
          : trimmed
        const ssePayload: Array<ChatAttachmentPayload> | undefined =
          hasAttachments
            ? attachments.map((a) => ({
                id: a.id,
                name: a.name,
                contentType: a.contentType,
                size: a.size,
                dataUrl: a.dataUrl,
              }))
            : undefined
        const stream = streamAgentEvents({
          sessionKey: optionsRef.current.sessionKey,
          friendlyId: optionsRef.current.friendlyId,
          message: enrichedMessage,
          idempotencyKey: userMessage.id,
          workspacePath: optionsRef.current.workspacePath,
          localAgentUrl: optionsRef.current.localAgentUrl,
          localWorkspaceRoot: optionsRef.current.localWorkspaceRoot,
          attachments: ssePayload,
          signal: abort.signal,
        })
        let sawAnyData = false
        // Counter of event types seen on this turn — when "no tool
        // visibility" reports come in, this lets us tell whether the agent
        // actually emitted any tool events or whether the gateway just sent
        // text. Logged once at end-of-stream so it doesn't spam. PROD too
        // (not gated on import.meta.env.DEV) so users can paste console
        // output when debugging without a dev rebuild.
        const eventCounts: Record<string, number> = {}
        for await (const event of stream) {
          if (!sawAnyData) {
            sawAnyData = true
            setStatus('streaming')
          }
          eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1
          applyEvent(assistantId, event)
          if (event.type === 'done') break
        }
        console.log('[chat-v2] SSE event counts', eventCounts)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'send failed')
      } finally {
        updateAssistant(assistantId, (m) => ({ ...m, streaming: false }))
        if (abortRef.current === abort) abortRef.current = null
        setStatus('idle')
      }
    },
    [status, applyEvent, updateAssistant],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, status, error, send, stop, clear }
}
