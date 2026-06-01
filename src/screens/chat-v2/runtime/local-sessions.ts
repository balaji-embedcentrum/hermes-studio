/**
 * Browser-local sessions index for chat-v2.
 *
 * Why this exists instead of /api/sessions:
 *   The hermes-adapter agent containers hold the canonical session list in
 *   their per-user SQLite. When the fleet wipes / rebuilds a container, that
 *   list disappears with it and the sidebar goes empty even though message
 *   history may still be reachable. Storing session metadata in the browser
 *   (localStorage) keeps the user's view of "my conversations" stable across
 *   agent restarts.
 *
 *   We only store the INDEX (sessionKey, label, last snippet, timestamps) —
 *   not the actual messages. Messages still live in the agent and are fetched
 *   on demand by /api/history. If a session can't be re-hydrated, that's a
 *   visible-but-recoverable state (user can delete the entry).
 *
 * Storage shape:
 *   localStorage[KEY] = JSON { version: 1, sessions: LocalSession[] }
 *
 * Cross-tab updates are broadcast via the native `storage` event; consumers
 * use subscribe() to re-read after another tab writes.
 */

const STORAGE_KEY = 'chatv2.sessions.v1'

export type LocalSession = {
  /** Same value used as the URL friendlyId / sessionKey */
  key: string
  /** Display label — first user message snippet, falls back to the key */
  label: string
  /** Short preview of the most recent user OR assistant message */
  lastSnippet: string | null
  createdAt: number
  updatedAt: number
}

type Stored = {
  version: 1
  sessions: Array<LocalSession>
}

const listeners = new Set<() => void>()

// Stable empty array reference for both the SSR snapshot of
// useSyncExternalStore AND the "no sessions" return from listLocalSessions().
// IMPORTANT: useSyncExternalStore requires getSnapshot() to return the SAME
// reference when the underlying data hasn't changed. Returning a freshly
// built array each call (e.g. `[...sessions].sort(...)`) makes React think
// the store changed on every render → infinite re-render loop → React error
// #185 "Maximum update depth exceeded". So we cache the sorted snapshot
// here and only rebuild it after a real write.
const EMPTY_SESSIONS: ReadonlyArray<LocalSession> = Object.freeze([])
let cachedSnapshot: ReadonlyArray<LocalSession> | null = null

function invalidateSnapshot(): void {
  cachedSnapshot = null
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function readStore(): Stored {
  if (!isBrowser()) return { version: 1, sessions: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, sessions: [] }
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { sessions?: unknown }).sessions)
    ) {
      return { version: 1, sessions: [] }
    }
    return parsed as Stored
  } catch {
    return { version: 1, sessions: [] }
  }
}

function writeStore(next: Stored): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    console.debug(
      `[chat-v2] sidebar index saved (${next.sessions.length} rows)`,
    )
  } catch (e) {
    // quota / private mode — surface so we can see what's wrong
    console.error('[chat-v2] sidebar index save failed', e)
  }
  invalidateSnapshot()
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // listener bug shouldn't break the writer
    }
  }
}

if (isBrowser()) {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    invalidateSnapshot()
    for (const fn of listeners) {
      try {
        fn()
      } catch {
        // ignore
      }
    }
  })
}

/**
 * Returns a STABLE array reference between writes — safe to use as the
 * `getSnapshot` argument to React.useSyncExternalStore. After any
 * upsert/delete (or cross-tab write) the cache is invalidated and the next
 * call rebuilds it.
 */
export function listLocalSessions(): ReadonlyArray<LocalSession> {
  if (cachedSnapshot !== null) return cachedSnapshot
  const { sessions } = readStore()
  if (sessions.length === 0) {
    cachedSnapshot = EMPTY_SESSIONS
    return cachedSnapshot
  }
  cachedSnapshot = Object.freeze(
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
  )
  return cachedSnapshot
}

/** Stable empty-array snapshot for SSR / first paint. */
export function listLocalSessionsServerSnapshot(): ReadonlyArray<LocalSession> {
  return EMPTY_SESSIONS
}

export function getLocalSession(key: string): LocalSession | null {
  const { sessions } = readStore()
  return sessions.find((s) => s.key === key) ?? null
}

/**
 * Insert or update a session. `label` is only applied when creating the entry
 * (or when the existing label is empty / equal to the key). `lastSnippet` is
 * always updated to the latest value passed in. updatedAt is bumped.
 */
export function upsertLocalSession(input: {
  key: string
  label?: string
  lastSnippet?: string | null
}): LocalSession {
  const now = Date.now()
  const store = readStore()
  const idx = store.sessions.findIndex((s) => s.key === input.key)
  const cleanedLabel = (input.label ?? '').trim()
  const cleanedSnippet = (input.lastSnippet ?? '').trim()

  let entry: LocalSession
  if (idx >= 0) {
    const existing = store.sessions[idx]
    const labelIsFallback =
      !existing.label || existing.label === existing.key
    const nextLabel =
      cleanedLabel && labelIsFallback ? cleanedLabel : existing.label
    const nextSnippet = cleanedSnippet || existing.lastSnippet
    // No-op short-circuit: if neither label nor snippet actually changed,
    // skip the write (and the listener fan-out). The effect in ChatScreenV2
    // calls us on every messages change, so most invocations are no-ops
    // once the label is set. Without this, every keystroke / token stream
    // re-renders every useSyncExternalStore subscriber.
    if (nextLabel === existing.label && nextSnippet === existing.lastSnippet) {
      return existing
    }
    entry = {
      ...existing,
      label: nextLabel,
      lastSnippet: nextSnippet,
      updatedAt: now,
    }
    store.sessions[idx] = entry
  } else {
    entry = {
      key: input.key,
      label: cleanedLabel || input.key,
      lastSnippet: cleanedSnippet || null,
      createdAt: now,
      updatedAt: now,
    }
    store.sessions.push(entry)
  }

  writeStore(store)
  return entry
}

export function deleteLocalSession(key: string): void {
  const store = readStore()
  const next = store.sessions.filter((s) => s.key !== key)
  if (next.length === store.sessions.length) return
  writeStore({ ...store, sessions: next })
  // Also drop the messages blob — no point keeping a session's transcript
  // for a row that no longer appears in the sidebar.
  deleteLocalSessionMessages(key)
}

export function clearLocalSessions(): void {
  writeStore({ version: 1, sessions: [] })
}

// ─── Per-session message persistence ───────────────────────────────────────
//
// The fleet's per-user agent (port 9001) does NOT expose /api/sessions —
// only OpenAI-compat /v1/chat/completions, /health, /v1/models and /ws/*.
// So the studio's /api/history can't read message history back from the
// agent in fleet mode; gateway-capabilities probes `sessions: false` and
// /api/history returns `{ source: 'unavailable', messages: [] }`.
//
// To make the chat reload-able, we mirror the sidebar-index pattern and
// store the messages themselves in localStorage too, keyed per-session.
// Agent still keeps its own copy (for in-stream context); studio just
// stops depending on the agent for read-back.
//
// Trade-offs (same as the sidebar index):
//   - per-browser / per-device, no cross-device sync
//   - clearing site data wipes history
//   - localStorage quota is ~5 MB per origin — large transcripts with
//     base64 attachments could blow it. We strip attachment dataUrls on
//     persist for that reason (kept name/size/contentType only).

const MESSAGES_KEY_PREFIX = 'chatv2.messages.v1.'

function messagesKey(sessionKey: string): string {
  return `${MESSAGES_KEY_PREFIX}${sessionKey}`
}

/**
 * Strip heavy fields from messages before persisting so a single big
 * attachment doesn't blow the 5 MB localStorage quota for the whole tab.
 * dataUrl (base64) is dropped — the agent already has the file; on
 * re-render we just show the name + size chip.
 */
function lightenMessagesForStorage(messages: ReadonlyArray<unknown>): unknown {
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m
    const msg = m as Record<string, unknown>
    const attachments = Array.isArray(msg.attachments)
      ? (msg.attachments as Array<Record<string, unknown>>).map((a) => ({
          ...a,
          dataUrl: undefined,
        }))
      : msg.attachments
    return { ...msg, attachments }
  })
}

export function saveLocalSessionMessages(
  sessionKey: string,
  messages: ReadonlyArray<unknown>,
): void {
  if (!isBrowser() || !sessionKey) {
    console.warn('[chat-v2] save skipped: no sessionKey or no window', {
      sessionKey,
    })
    return
  }
  // First try the simple path — serialize the whole array at once.
  const lightened = lightenMessagesForStorage(messages)
  let payload: string
  try {
    payload = JSON.stringify({ version: 1, messages: lightened })
  } catch (e) {
    // Some tool result contained a value JSON.stringify can't handle
    // (function, Symbol, circular ref, BigInt). Fall back to per-message
    // serialization with a placeholder for the bad ones so the rest still
    // persists. Loudly — silent failure here is exactly what was hiding
    // the bug before.
    console.error(
      '[chat-v2] save full-array JSON.stringify failed, falling back per-message',
      e,
    )
    const safeMessages = (lightened as Array<unknown>).map((m, i) => {
      try {
        JSON.stringify(m)
        return m
      } catch (innerErr) {
        console.error(
          `[chat-v2] save dropping message[${i}] (non-serializable)`,
          innerErr,
        )
        return {
          id: `unserializable_${i}`,
          role: 'assistant',
          parts: [{ type: 'text', text: '[unserializable message dropped]' }],
        }
      }
    })
    try {
      payload = JSON.stringify({ version: 1, messages: safeMessages })
    } catch (eRetry) {
      console.error('[chat-v2] save retry also failed, aborting', eRetry)
      return
    }
  }
  try {
    localStorage.setItem(messagesKey(sessionKey), payload)
    // One concise success line per save — lets the user verify in
    // devtools that persistence is actually happening for the active
    // session, and what key it's under.
    console.debug(
      `[chat-v2] saved ${(messages as Array<unknown>).length} msg → ${messagesKey(sessionKey)} (${payload.length} bytes)`,
    )
  } catch (e) {
    // Quota / private mode / disabled — surface it.
    console.error(
      `[chat-v2] localStorage.setItem failed for ${messagesKey(sessionKey)} (${payload.length} bytes)`,
      e,
    )
  }
}

export function getLocalSessionMessages<T = unknown>(
  sessionKey: string,
): Array<T> | null {
  if (!isBrowser() || !sessionKey) return null
  try {
    const raw = localStorage.getItem(messagesKey(sessionKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { messages?: unknown }).messages)
    ) {
      return null
    }
    return (parsed as { messages: Array<T> }).messages
  } catch {
    return null
  }
}

export function deleteLocalSessionMessages(sessionKey: string): void {
  if (!isBrowser() || !sessionKey) return
  try {
    localStorage.removeItem(messagesKey(sessionKey))
  } catch {
    // ignore
  }
}

/**
 * Subscribe to changes (this tab AND cross-tab). Returns an unsubscribe fn.
 * Useful for React useSyncExternalStore.
 */
export function subscribeLocalSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Truncate a string for the sidebar preview line. */
export function snippetFromText(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
