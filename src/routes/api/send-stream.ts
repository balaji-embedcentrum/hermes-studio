import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { resolveSessionKey } from '../../server/session-utils'
import { isAuthenticated } from '../../server/auth-middleware'
import { getAuthUser } from '../../server/supabase-auth'
import { requireJsonContentType } from '../../server/rate-limit'
import { publishChatEvent } from '../../server/chat-event-bus'
import {
  registerActiveSendRun,
  unregisterActiveSendRun,
} from '../../server/send-run-tracker'
import { getChatMode } from '../../server/gateway-capabilities'
import { validateSession } from '../../server/agent-sessions'
import { invalidateWorkspace } from '../../sylang/symbolManager/workspaceSymbolCache'
import {
  
  
  openaiChat
} from '../../server/openai-compat-api'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  ensureGatewayProbed,
  getGatewayCapabilities,
  streamChat,
} from '../../server/hermes-api'
import type {OpenAICompatContentPart, OpenAICompatMessage} from '../../server/openai-compat-api';
// Hermes agent runs can take 5+ minutes with complex tool chains
const SEND_STREAM_RUN_TIMEOUT_MS = 600_000
const SESSION_BOOTSTRAP_KEYS = new Set(['main', 'new'])

/**
 * Tool names that mutate files on the agent's filesystem.
 *
 * The agent runs on a VPS, applies these tools directly to disk, and only
 * tells the studio about them via streaming `tool` SSE frames — never via
 * `/api/files`. So this list is the studio's ONLY signal that workspace
 * symbols may now be stale and need re-reading.
 *
 * Keep in sync with hermes-agent/tools/file_tools.py registry.
 */
const FILE_MUTATING_TOOLS = new Set(['write_file', 'patch'])

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function stripDataUrlPrefix(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const commaIndex = trimmed.indexOf(',')
  if (trimmed.toLowerCase().startsWith('data:') && commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1).trim()
  }
  return trimmed
}

function normalizeAttachments(
  attachments: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined
  }

  const normalized: Array<Record<string, unknown>> = []
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue
    const source = attachment as Record<string, unknown>

    const id = readString(source.id)
    const name = readString(source.name) || readString(source.fileName)
    const mimeType =
      readString(source.contentType) ||
      readString(source.mimeType) ||
      readString(source.mediaType)
    const size = readNumber(source.size)

    const base64Raw =
      readString(source.content) ||
      readString(source.data) ||
      readString(source.base64) ||
      readString(source.dataUrl)
    const content = stripDataUrlPrefix(base64Raw)
    if (!content) continue

    const type =
      readString(source.type) ||
      (mimeType.toLowerCase().startsWith('image/') ? 'image' : 'file')

    const dataUrl =
      readString(source.dataUrl) ||
      (mimeType ? `data:${mimeType};base64,${content}` : '')

    normalized.push({
      id: id || undefined,
      name: name || undefined,
      fileName: name || undefined,
      type,
      contentType: mimeType || undefined,
      mimeType: mimeType || undefined,
      mediaType: mimeType || undefined,
      content,
      data: content,
      base64: content,
      dataUrl: dataUrl || undefined,
      size,
    })
  }

  return normalized.length > 0 ? normalized : undefined
}

function getChatMessage(
  message: string,
  attachments?: Array<Record<string, unknown>>,
): string {
  if (message.trim().length > 0) return message
  if (attachments && attachments.length > 0) {
    return 'Please review the attached content.'
  }
  return message
}

/**
 * Build OpenAI-compatible multimodal content for portable mode.
 * If there are image attachments, returns an array of content parts;
 * otherwise returns a plain string.
 */
function buildMultimodalContent(
  message: string,
  attachments?: Array<Record<string, unknown>>,
): string | Array<OpenAICompatContentPart> {
  const imageParts: Array<OpenAICompatContentPart> = []

  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      const mime = (att.contentType ||
        att.mimeType ||
        att.mediaType ||
        '') as string
      if (!mime.toLowerCase().startsWith('image/')) continue

      let b64 = (att.base64 || att.content || att.data || '') as string
      if (!b64) {
        const dataUrl = (att.dataUrl || '') as string
        if (dataUrl.startsWith('data:') && dataUrl.includes(',')) {
          b64 = dataUrl.split(',')[1]
        }
      }
      if (!b64) continue

      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${b64}` },
      })
    }
  }

  if (imageParts.length === 0) {
    return getChatMessage(message, attachments)
  }

  const parts: Array<OpenAICompatContentPart> = []
  const text = message.trim() || 'Please review the attached content.'
  parts.push({ type: 'text', text })
  parts.push(...imageParts)
  return parts
}

type PortableHistoryMessage = {
  role: string
  content: string
}

function normalizePortableHistory(
  value: unknown,
): Array<PortableHistoryMessage> {
  if (!Array.isArray(value) || value.length === 0) return []

  const normalized: Array<PortableHistoryMessage> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const role = readString(record.role)
    const content = readString(record.content)
    if (!role || !content) continue
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    normalized.push({ role, content })
  }

  return normalized
}

function normalizeHermesErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.trim()
  if (!message) return 'Hermes request failed'
  return message.replace(/\bserver\b/gi, 'Hermes')
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function getToolName(data: Record<string, unknown>): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
  const toolFunction = readRecord(toolCall?.function)
  return (
    readString(toolCall?.tool_name) ||
    readString(toolCall?.name) ||
    readString(toolFunction?.name) ||
    readString(tool?.name) ||
    readString(data.tool_name) ||
    readString(data.name) ||
    'tool'
  )
}

function getToolCallId(
  data: Record<string, unknown>,
  runId: string | undefined,
  toolName: string,
): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
  return (
    readString(toolCall?.id) ||
    readString(tool?.id) ||
    readString(data.tool_call_id) ||
    readString(data.call_id) ||
    readString(data.id) ||
    `${runId || 'run'}:${toolName}`
  )
}

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

function getToolArgs(data: Record<string, unknown>): unknown {
  const toolCall = readRecord(data.tool_call)
  const toolFunction = readRecord(toolCall?.function)
  return parseJsonIfPossible(
    toolCall?.arguments ?? toolFunction?.arguments ?? data.args,
  )
}

function getToolResultPreview(data: Record<string, unknown>): string {
  const raw = data.result_preview ?? data.result ?? data.output ?? data.message
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

export const Route = createFileRoute('/api/send-stream')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth check
        if (!(await isAuthenticated(request))) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // Session enforcement — validate active agent session for remote agents.
        // If session expired and user is Pro/Ultra, auto-renew happens inside validateSession.
        const authUserForSession = await getAuthUser(request).catch(() => null)
        if (authUserForSession?.userId) {
          const sessionCheck = await validateSession(authUserForSession.userId)
          if (!sessionCheck.valid) {
            const status = sessionCheck.code === 'expired' ? 402 : 403
            return new Response(
              JSON.stringify({ ok: false, error: sessionCheck.error, code: sessionCheck.code, autoRenewed: false }),
              { status, headers: { 'Content-Type': 'application/json' } },
            )
          }
          // If auto-renewed, include that info for the client
          if (sessionCheck.autoRenewed) {
            // Attach header so client knows to refresh timer
            request.headers.set('X-Session-Renewed', 'true')
          }
        }

        await ensureGatewayProbed()

        // Read body manually to handle large payloads (image attachments
        // can push the JSON body above the default ~1MB parse limit).
        let body: Record<string, unknown> = {}
        try {
          const rawBody = await request.text()
          body = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          // Fall through — body stays empty, will hit 'message required' below
        }

        const rawSessionKey =
          typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
        const requestedFriendlyId =
          typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
        const message = String(body.message ?? '')
        const thinking =
          typeof body.thinking === 'string' ? body.thinking : undefined
        // Workspace path (relative from WORKSPACE_ROOT) passed by the frontend
        // when the user has an active project open. Used to tell the Hermes agent
        // the correct directory to work in.
        const workspaceRelPath =
          typeof body.workspacePath === 'string' ? body.workspacePath.trim() : ''
        const attachments = normalizeAttachments(body.attachments)
        const history = normalizePortableHistory(body.history)
        if (!message.trim() && (!attachments || attachments.length === 0)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'message required' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        // Resolve session key
        let sessionKey: string
        let resolvedFriendlyId: string
        try {
          const resolved = await resolveSessionKey({
            rawSessionKey,
            friendlyId: requestedFriendlyId,
            defaultKey: 'main',
          })
          sessionKey = resolved.sessionKey
          resolvedFriendlyId = resolved.sessionKey
        } catch (err) {
          const errorMsg = normalizeHermesErrorMessage(err)
          if (errorMsg === 'session not found') {
            return new Response(
              JSON.stringify({ ok: false, error: 'session not found' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
          return new Response(JSON.stringify({ ok: false, error: errorMsg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // If the user is authenticated, always use portable mode — their selected
        // agent is reachable via getAgentConfig. The local Hermes probe may have
        // failed (localhost:8642 not running), but that's irrelevant for remote users.
        const chatMode = authUserForSession?.userId ? 'portable' : getChatMode()
        if (chatMode === 'portable' && sessionKey === 'new') {
          sessionKey = crypto.randomUUID()
          resolvedFriendlyId = sessionKey
        }

        // Build workspace context string to inject into the system message.
        //
        // The boundary fires in TWO layers:
        //   1) Workspace root — the agent's per-user view, e.g.
        //      /opt/workspaces/active-<agent>. ALWAYS injected for
        //      cloud-fleet users so the agent refuses to walk above this
        //      even when no project is selected (the screenshot bug:
        //      agent searched /opt/workspaces and found another user's dir).
        //   2) Project — when the user has opened a specific project,
        //      add tighter rules scoping to that repo.
        //
        // Both rules are injected as a system message on every turn, so
        // they override anything the agent might recall from history.
        let workspaceContextNote: string | undefined

        const agentWorkspaceRoot = (
          process.env.HERMES_AGENT_WORKSPACE_ROOT || '/opt/workspaces'
        ).trim()

        // The fleet bind-mounts the *user's* workspace dir directly at
        // /opt/workspaces inside the agent container — see
        // hermes-adapter/.../fleet/orchestrator.py:_render_claimed_override
        //   "- ./workspaces/{user}:/opt/workspaces"
        // So projects live at /opt/workspaces/<repo> in the container,
        // NOT at /opt/workspaces/active-<agent>/<github_login>/<repo>
        // (which is what the previous version of this code assumed and
        // which sent the agent on a wild goose chase through "No such
        // file or directory" tool calls before it stumbled onto the real
        // path). The per-agent / per-user isolation is enforced by the
        // bind mount itself, not by an in-path subdirectory.
        //
        // We keep the workspace-root boundary in the system prompt so
        // the model still has the "don't escape your sandbox" rule,
        // but the root IS /opt/workspaces — same as the mount.
        const perAgentWorkspaceRoot: string | null = authUserForSession?.userId
          ? agentWorkspaceRoot
          : null

        const segments = workspaceRelPath
          ? workspaceRelPath.replace(/\\/g, '/').split('/')
          : []
        // segments[0]=userId, segments[1]=githubLogin, segments[2]=repo, ...
        // The userId + githubLogin segments are studio-side bookkeeping
        // that doesn't exist inside the container — the bind mount strips
        // them. Only the repo (and any deeper path) maps to the agent FS.
        const githubLogin = segments[1] || ''
        const repoName = segments[2] || ''
        const agentRelPath = segments.slice(2).join('/')
        const absWorkspacePath = agentRelPath
          ? `${agentWorkspaceRoot}/${agentRelPath}`
          : null

        if (perAgentWorkspaceRoot || absWorkspacePath) {
          const lines: string[] = []
          lines.push(`=== AGENT EXECUTION CONTEXT (overrides all prior state) ===`)
          lines.push(``)

          if (perAgentWorkspaceRoot) {
            lines.push(`AGENT WORKSPACE ROOT (hard boundary): ${perAgentWorkspaceRoot}`)
            lines.push(``)
            lines.push(`Your workspace is bind-mounted at ${perAgentWorkspaceRoot}.`)
            lines.push(`Stay inside this directory for every file / list / search /`)
            lines.push(`grep / read / write / terminal call. Don't cd .. above it,`)
            lines.push(`don't touch /etc, /root, /home, /var, /tmp/<other>, /proc, /sys.`)
            lines.push(`If asked to "search the entire workspace" or "list everything",`)
            lines.push(`scope it to ${perAgentWorkspaceRoot}/ and its subdirectories.`)
            lines.push(`Use your terminal tool with cwd= inside the workspace.`)
            lines.push(``)
          }

          if (absWorkspacePath && repoName) {
            lines.push(`CURRENT PROJECT: ${repoName}`)
            lines.push(`PROJECT ROOT:    ${absWorkspacePath}`)
            if (githubLogin) lines.push(`USER:            ${githubLogin}`)
            lines.push(``)
            lines.push(`This is the ONLY project you are working on right now. If you`)
            lines.push(`previously worked on a different project in this chat history,`)
            lines.push(`discard that context — the user has switched projects.`)
            lines.push(``)
            lines.push(`Project-scope rules (in addition to the workspace root rules above):`)
            lines.push(`1. Every file read / write / list / search / grep MUST be inside`)
            lines.push(`   ${absWorkspacePath}.`)
            lines.push(`2. When asked about "the project", "this repo", "the codebase",`)
            lines.push(`   it refers ONLY to ${repoName} at ${absWorkspacePath}.`)
            lines.push(`3. If asked "what projects do I have", do NOT list sibling`)
            lines.push(`   directories. Only reply about ${repoName}.`)
            lines.push(``)
            lines.push(`After modifying files: git add -A && git commit -m "agent: <description>" && git push`)
            lines.push(``)
            lines.push(`Use your full tool, skill, and reasoning capabilities to help`)
            lines.push(`within ${absWorkspacePath}. The directory scope is the only`)
            lines.push(`restriction.`)
            lines.push(``)
          }

          lines.push(`USER-ATTACHED IMAGES:`)
          lines.push(`When the user pastes or uploads an image, the studio persists`)
          lines.push(`it to /tmp/hermes_inbound_images/<uuid>.<ext> and references the`)
          lines.push(`path in the user message as a [image: /tmp/hermes_inbound_images/...]`)
          lines.push(`marker. Those specific files are SAFE to read with the Read tool`)
          lines.push(`even though the general /tmp prohibition above stands — they are`)
          lines.push(`user-provided attachments meant for you to look at. The general`)
          lines.push(`/tmp prohibition still applies to every other /tmp path.`)
          lines.push(``)
          lines.push(`SKILLS AVAILABLE:`)
          lines.push(`Sylang and Jot skills are already installed in your skills folder.`)
          lines.push(`For any Sylang or Jot related work, consult those skills first`)
          lines.push(`instead of guessing syntax or conventions.`)

          workspaceContextNote = lines.join('\n')
        }

        // Create streaming response using the SHARED server connection
        const encoder = new TextEncoder()
        let streamClosed = false
        let activeRunId: string | null = null
        let unregisterTimer: ReturnType<typeof setTimeout> | null = null
        const abortController = new AbortController()
        let closeStream = () => {
          streamClosed = true
        }

        const stream = new ReadableStream({
          async start(controller) {
            const sendEvent = (event: string, data: unknown) => {
              if (streamClosed) return
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              controller.enqueue(encoder.encode(payload))
            }

            // Heartbeat every 15 s keeps the SSE connection alive through
            // proxies and load-balancers that close idle connections.
            const heartbeatInterval = setInterval(() => {
              if (streamClosed) {
                clearInterval(heartbeatInterval)
                return
              }
              try {
                controller.enqueue(encoder.encode(': heartbeat\n\n'))
              } catch {
                clearInterval(heartbeatInterval)
              }
            }, 15_000)

            closeStream = () => {
              if (streamClosed) return
              streamClosed = true
              clearInterval(heartbeatInterval)
              if (unregisterTimer) {
                clearTimeout(unregisterTimer)
                unregisterTimer = null
              }
              if (activeRunId) {
                unregisterActiveSendRun(activeRunId)
                activeRunId = null
              }
              abortController.abort()
              try {
                controller.close()
              } catch {
                // ignore
              }
            }

            try {
              if (chatMode === 'portable') {
                const runId = crypto.randomUUID()
                const portableSessionKey = sessionKey
                const portableFriendlyId =
                  resolvedFriendlyId ||
                  requestedFriendlyId ||
                  rawSessionKey ||
                  portableSessionKey
                let accumulated = ''

                activeRunId = runId
                registerActiveSendRun(runId)
                unregisterTimer = setTimeout(() => {
                  if (activeRunId) {
                    unregisterActiveSendRun(activeRunId)
                    activeRunId = null
                  }
                }, SEND_STREAM_RUN_TIMEOUT_MS)

                sendEvent('started', {
                  runId,
                  sessionKey: portableSessionKey,
                  friendlyId: portableFriendlyId,
                })

                try {
                  const userContent = buildMultimodalContent(
                    message,
                    attachments,
                  )
                  // For fresh sessions (new-*), don't include old history
                  const isNewSession = rawSessionKey === 'new' || rawSessionKey?.startsWith('new-')
                  const portableMessages: Array<OpenAICompatMessage> = [
                    ...(workspaceContextNote ? [{ role: 'system' as const, content: workspaceContextNote }] : []),
                    ...(isNewSession ? [] : history),
                    {
                      role: 'user',
                      content: userContent,
                    },
                  ]
                  // Get the user's selected agent URL
                  const authUser = await getAuthUser(request).catch(() => null)
                  const userId = authUser?.userId
                  console.info(`[send-stream] userId=${userId ?? 'NONE'}, portable mode, sending to agent...`)
                  // Include userId in session ID so each user gets isolated history on the agent
                  const agentSessionId = userId
                    ? `${userId}:${portableSessionKey}`
                    : portableSessionKey
                  const stream = await openaiChat(portableMessages, {
                    model:
                      typeof body.model === 'string' ? body.model : undefined,
                    temperature:
                      typeof body.temperature === 'number'
                        ? body.temperature
                        : undefined,
                    signal: abortController.signal,
                    stream: true,
                    sessionId: agentSessionId,
                    userId: authUser?.userId,
                  })

                  let thinking = ''
                  for await (const chunk of stream) {
                    if (chunk.type === 'reasoning') {
                      thinking += chunk.text
                      sendEvent('thinking', {
                        text: thinking,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    } else if (chunk.type === 'tool') {
                      // hermes-adapter emits `event: tool` SSE frames with
                      // {phase, id, name, args, result} when the agent runs a
                      // tool — forward to chat-v2 so it can render the tool
                      // card without waiting for the final assistant message.
                      const t = chunk.tool
                      // If the agent just modified a file, drop our cached
                      // symbol graph for this workspace. The agent writes
                      // directly to its own filesystem, so this stream event
                      // is the only signal we get — `/api/files` never fires
                      // for agent-initiated writes. Next diagram/matrix fetch
                      // will re-init from the agent's fresh state.
                      if (
                        t.phase === 'complete' &&
                        workspaceRelPath &&
                        typeof t.name === 'string' &&
                        FILE_MUTATING_TOOLS.has(t.name)
                      ) {
                        invalidateWorkspace(workspaceRelPath)
                      }
                      sendEvent('tool', {
                        phase: t.phase,
                        name: t.name,
                        toolCallId: t.id,
                        args: t.args,
                        result: t.result,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    } else {
                      // Forward the DELTA (chunk.text), not the running
                      // accumulated total. chat-v2's chunk handler treats
                      // missing `fullReplace` as append, so each delta is
                      // tacked onto the most recent text part. Sending
                      // `accumulated` with `fullReplace: true` would be
                      // dropped after tools fire — chat-v2's anti-
                      // duplication guard skips fullReplace=true frames
                      // when tool parts are already present in the bubble.
                      // Result was: tools rendered, but the final
                      // assistant text never appeared after them.
                      accumulated += chunk.text
                      sendEvent('chunk', {
                        text: chunk.text,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    }
                  }

                  sendEvent('done', {
                    state: 'complete',
                    sessionKey: portableSessionKey,
                    runId,
                    message: {
                      role: 'assistant',
                      content: [
                        ...(thinking ? [{ type: 'thinking', thinking }] : []),
                        { type: 'text', text: accumulated },
                      ],
                    },
                  })
                  closeStream()
                } catch (err) {
                  if (!streamClosed) {
                    sendEvent('error', {
                      message: normalizeHermesErrorMessage(err),
                      sessionKey: portableSessionKey,
                      runId,
                    })
                    closeStream()
                  }
                }
                return
              }

              if (!getGatewayCapabilities().sessions) {
                throw new Error(SESSIONS_API_UNAVAILABLE_MESSAGE)
              }

              if (SESSION_BOOTSTRAP_KEYS.has(sessionKey)) {
                const session = await createSession()
                sessionKey = session.id
                resolvedFriendlyId = session.id
              }

              let startedSent = false
              // In enhanced mode, the HTTP stream response delivers all events
              // directly to useStreamingMessage. Skip publishChatEvent to prevent
              // useRealtimeChatHistory from creating duplicate message bubbles.
              const skipPublish = true
              await streamChat(
                sessionKey,
                {
                  message: getChatMessage(message, attachments),
                  model:
                    typeof body.model === 'string' ? body.model : undefined,
                  system_message: [thinking, workspaceContextNote]
                    .filter(Boolean)
                    .join('\n\n') || undefined,
                  attachments: attachments || undefined,
                },
                {
                  signal: abortController.signal,
                  onEvent({ event, data }) {
                    const sessionKeyFromEvent =
                      typeof data.session_id === 'string' &&
                      data.session_id.trim()
                        ? data.session_id
                        : sessionKey
                    const runId =
                      typeof data.run_id === 'string' && data.run_id.trim()
                        ? data.run_id
                        : (activeRunId ?? undefined)

                    if (runId && !activeRunId) {
                      activeRunId = runId
                      registerActiveSendRun(runId)
                      unregisterTimer = setTimeout(() => {
                        if (activeRunId) {
                          unregisterActiveSendRun(activeRunId)
                          activeRunId = null
                        }
                      }, SEND_STREAM_RUN_TIMEOUT_MS)
                    }

                    if (!startedSent && runId) {
                      startedSent = true
                      sendEvent('started', {
                        runId,
                        sessionKey: sessionKeyFromEvent,
                        friendlyId: sessionKeyFromEvent,
                      })
                    }

                    if (event === 'run.started') {
                      const userMessage =
                        data.user_message &&
                        typeof data.user_message === 'object'
                          ? (data.user_message as Record<string, unknown>)
                          : null
                      if (userMessage) {
                        skipPublish ||
                          publishChatEvent('user_message', {
                            message: {
                              id: userMessage.id,
                              role: userMessage.role ?? 'user',
                              content: [
                                {
                                  type: 'text',
                                  text:
                                    typeof userMessage.content === 'string'
                                      ? userMessage.content
                                      : '',
                                },
                              ],
                            },
                            sessionKey: sessionKeyFromEvent,
                            source: 'hermes',
                            runId,
                          })
                      }
                      return
                    }

                    if (event === 'message.started') {
                      const message =
                        data.message && typeof data.message === 'object'
                          ? (data.message as Record<string, unknown>)
                          : {}
                      const translated = {
                        message: {
                          id: message.id,
                          role: 'assistant',
                          content: [],
                        },
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('message', translated)
                      skipPublish || publishChatEvent('message', translated)
                      return
                    }

                    if (event === 'assistant.completed') {
                      // Send full content as a chunk — covers cases where
                      // deltas were missed or response was too short for streaming
                      const content =
                        typeof data.content === 'string' ? data.content : ''
                      if (content) {
                        const translated = {
                          text: content,
                          fullReplace: true,
                          sessionKey: sessionKeyFromEvent,
                          runId,
                        }
                        sendEvent('chunk', translated)
                        skipPublish || publishChatEvent('chunk', translated)
                      }
                      return
                    }

                    if (event === 'assistant.delta') {
                      const delta =
                        typeof data.delta === 'string' ? data.delta : ''
                      if (!delta) return
                      const translated = {
                        text: delta,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('chunk', translated)
                      skipPublish || publishChatEvent('chunk', translated)
                      return
                    }

                    if (
                      event === 'tool.pending' ||
                      event === 'tool.started' ||
                      event === 'tool.calling' ||
                      event === 'tool.running'
                    ) {
                      const toolName = getToolName(data)
                      const preview =
                        typeof data.preview === 'string'
                          ? data.preview
                          : undefined
                      const translated = {
                        phase:
                          event === 'tool.pending' || event === 'tool.started'
                            ? 'start'
                            : 'calling',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        preview,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.progress') {
                      const delta = readString(data.delta)
                      const toolName = getToolName(data)
                      if (toolName === '_thinking' || toolName === 'tool') {
                        if (!delta) return
                        const translated = {
                          text: delta,
                          sessionKey: sessionKeyFromEvent,
                          runId,
                        }
                        sendEvent('thinking', translated)
                        skipPublish || publishChatEvent('thinking', translated)
                        return
                      }
                      const translated = {
                        phase: 'calling',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        result: delta || undefined,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.completed') {
                      const toolName = getToolName(data)
                      const resultPreview = getToolResultPreview(data)
                      // Same rationale as the portable-mode branch above:
                      // agent file mutations only show up here.
                      if (workspaceRelPath && FILE_MUTATING_TOOLS.has(toolName)) {
                        invalidateWorkspace(workspaceRelPath)
                      }
                      const translated = {
                        phase: 'complete',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        result: resultPreview.slice(0, 4000),
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'artifact.created') {
                      const artifact =
                        data.artifact && typeof data.artifact === 'object'
                          ? (data.artifact as Record<string, unknown>)
                          : {}
                      const translated = {
                        phase: 'complete',
                        name: readString(data.tool_name) || 'artifact',
                        toolCallId: readString(data.tool_call_id) || undefined,
                        result:
                          readString(artifact.title) ||
                          readString(artifact.path) ||
                          readString(data.path) ||
                          'Artifact created',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'memory.updated') {
                      const translated = {
                        phase: 'complete',
                        name: 'memory',
                        toolCallId: readString(data.tool_call_id) || undefined,
                        result:
                          readString(data.message) ||
                          `Updated ${readString(data.target) || 'memory'}`,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'skill.loaded') {
                      const skill =
                        data.skill && typeof data.skill === 'object'
                          ? (data.skill as Record<string, unknown>)
                          : {}
                      const translated = {
                        phase: 'complete',
                        name: 'skill',
                        toolCallId: readString(data.tool_call_id) || undefined,
                        result:
                          readString(skill.name) ||
                          readString(data.skill_name) ||
                          'Skill loaded',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.failed') {
                      const errorMessage =
                        readString(
                          (data.error as Record<string, unknown> | undefined)
                            ?.message,
                        ) || readString(data.message)
                      const toolName = getToolName(data)
                      const translated = {
                        phase: 'error',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        result: errorMessage,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('tool', translated)
                      skipPublish || publishChatEvent('tool', translated)
                      return
                    }

                    if (event === 'error') {
                      const errorMessage =
                        readString(
                          (data.error as Record<string, unknown> | undefined)
                            ?.message,
                        ) ||
                        readString(data.message) ||
                        'Hermes stream error'
                      sendEvent('error', {
                        message: errorMessage,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      })
                      closeStream()
                      return
                    }

                    if (event === 'run.completed') {
                      const translated = {
                        state: 'complete',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('done', translated)
                      skipPublish || publishChatEvent('done', translated)
                      closeStream()
                    }
                  },
                },
              )

              // streamChat resolved — upstream stream is fully consumed.
              // If no event triggered closeStream() (i.e. upstream finished
              // without an explicit run.completed/error), emit a clean done
              // so the client doesn't sit waiting for the SSE to close, and
              // never surface this as a phantom "Stream timeout" error.
              if (!streamClosed) {
                sendEvent('done', {
                  state: 'complete',
                  sessionKey,
                  runId: activeRunId ?? undefined,
                })
                closeStream()
              }
            } catch (err) {
              // Only send error if stream hasn't already completed successfully
              if (!streamClosed) {
                const errorMsg = normalizeHermesErrorMessage(err)
                sendEvent('error', {
                  message: errorMsg,
                  sessionKey,
                })
                closeStream()
              }
            }
          },
          cancel() {
            closeStream()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Hermes-Session-Key': sessionKey,
            'X-Hermes-Friendly-Id': resolvedFriendlyId,
          },
        })
      },
    },
  },
})
