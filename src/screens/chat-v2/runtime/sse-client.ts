/**
 * Minimal SSE client for /api/send-stream. Parses the named-event stream
 * (event: <name>\ndata: <json>\n\n) into a typed async iterator. No retries,
 * no reconnect — the new chat runtime owns lifecycle and re-opens per send.
 */

export type AgentEventType =
  | 'started'
  | 'chunk'
  | 'thinking'
  | 'tool'
  | 'message'
  | 'done'
  | 'error'
  | 'lifecycle'
  | 'status'

export type AgentEvent = {
  type: AgentEventType
  data: Record<string, unknown>
}

export type ChatAttachmentPayload = {
  id: string
  name: string
  contentType: string
  size: number
  /** Full data: URL with base64-encoded content. The server strips the prefix. */
  dataUrl: string
}

export type SendStreamParams = {
  sessionKey: string
  friendlyId: string
  message: string
  history?: Array<{ role: string; content: string }>
  thinking?: string
  fastMode?: boolean
  idempotencyKey?: string
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
  attachments?: Array<ChatAttachmentPayload>
  signal?: AbortSignal
}

/**
 * Opens a POST to /api/send-stream and yields typed events as they arrive.
 * Throws on network failure; emits an 'error' event if the agent reports one.
 */
export async function* streamAgentEvents(
  params: SendStreamParams,
): AsyncGenerator<AgentEvent> {
  const { signal, ...body } = params
  const response = await fetch('/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`send-stream returned ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line.
      let frameEnd = buffer.indexOf('\n\n')
      while (frameEnd !== -1) {
        const rawFrame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        frameEnd = buffer.indexOf('\n\n')

        const event = parseFrame(rawFrame)
        if (event) yield event
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(frame: string): AgentEvent | null {
  let eventType: string | null = null
  const dataLines: Array<string> = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (!eventType || dataLines.length === 0) return null

  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
  } catch {
    return null
  }
  return { type: eventType as AgentEventType, data }
}
