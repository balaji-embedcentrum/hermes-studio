/**
 * useActiveSession — tracks whether the user has an active agent session.
 * Uses Supabase realtime to get instant updates when session starts/ends.
 * Falls back to initial fetch on mount.
 * Local agent users always return true (no session limit).
 */
import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSessionRealtime } from '@/hooks/use-session-realtime'

const DBG = '[useActiveSession]'
const log = (...args: unknown[]) => {
  if (typeof console !== 'undefined') console.log(DBG, ...args)
}

type SessionInfo = {
  sessionId: string
  agentName: string
  expiresAt: string
  timeRemainingMs: number
}

export function useActiveSession() {
  const localHermesUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const setHasSessionLogged = useCallback(
    (next: boolean | null, source: string) => {
      log('setHasSession', { next, source })
      setHasSession(next)
    },
    [],
  )

  const check = useCallback(async () => {
    log('check() start', { localHermesUrl })
    if (localHermesUrl) {
      setHasSessionLogged(true, 'check:localHermesUrl')
      return
    }
    void fetch('/api/auth-check')
      .then((r) => r.json())
      .then((data: { userId?: string }) => {
        log('auth-check ok', { userId: data.userId })
        if (data.userId) setUserId(data.userId)
      })
      .catch((err) => {
        log('auth-check FAILED (ignored)', err)
      })
    try {
      const raw = await fetch('/api/agent-sessions/status')
      log('status fetch returned', {
        ok: raw.ok,
        status: raw.status,
        contentType: raw.headers.get('content-type'),
      })
      const sessRes = (await raw.json()) as { session: SessionInfo | null }
      log('status body', sessRes)
      setSession(sessRes.session)
      setHasSessionLogged(Boolean(sessRes.session), 'check:status-ok')
    } catch (err) {
      log('status FAILED (catch)', err)
      setHasSessionLogged(false, 'check:status-catch')
    }
  }, [localHermesUrl, setHasSessionLogged])

  useEffect(() => {
    log('mount + check effect', { hasSession, userId })
    check()
    return () => log('unmount')
  }, [check])

  const handleRealtimeChange = useCallback(async () => {
    log('realtime fired — re-fetching status')
    try {
      const raw = await fetch('/api/agent-sessions/status')
      log('realtime status fetch', { ok: raw.ok, status: raw.status })
      const data = (await raw.json()) as { session: SessionInfo | null }
      log('realtime status body', data)
      setSession(data.session)
      setHasSessionLogged(Boolean(data.session), 'realtime:status-ok')
    } catch (err) {
      log('realtime status FAILED (kept state)', err)
    }
  }, [setHasSessionLogged])
  useSessionRealtime(userId, handleRealtimeChange)

  return { hasSession, session, refresh: check }
}
