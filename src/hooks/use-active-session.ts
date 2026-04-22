/**
 * useActiveSession — tracks whether the user has an active agent session.
 * Uses Supabase realtime to get instant updates when session starts/ends.
 * Falls back to initial fetch on mount.
 * Local agent users always return true (no session limit).
 */
import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSessionRealtime } from '@/hooks/use-session-realtime'

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

  // Initial fetch. Auth-check and session-status are independent —
  // wrapping them in Promise.all let a transient auth-check failure
  // (network blip, 500, non-JSON) flip hasSession=false even when the
  // session endpoint returned a perfectly valid active session. Run
  // them as independent promises so they can't cross-contaminate.
  const check = useCallback(async () => {
    if (localHermesUrl) {
      setHasSession(true)
      return
    }
    void fetch('/api/auth-check')
      .then((r) => r.json())
      .then((data: { userId?: string }) => {
        if (data.userId) setUserId(data.userId)
      })
      .catch(() => {
        /* auth-check failure must not affect session state */
      })
    try {
      const sessRes = (await fetch('/api/agent-sessions/status').then((r) =>
        r.json(),
      )) as { session: SessionInfo | null }
      setSession(sessRes.session)
      setHasSession(Boolean(sessRes.session))
    } catch {
      setHasSession(false)
    }
  }, [localHermesUrl])

  useEffect(() => {
    check()
  }, [check])

  // Realtime — re-query the authoritative status endpoint on ANY change
  // to this user's agent_sessions rows. Do NOT trust the pushed row:
  // switching agents fires an UPDATE (old session → ended) followed by
  // an INSERT (new session → active). Treating the first event as
  // "no active session" flips hasSession=false while the second event's
  // active row is the real current state. If that second event is
  // delayed or dropped (realtime/RLS edge case), the lock sticks.
  const handleRealtimeChange = useCallback(async () => {
    try {
      const data = (await fetch('/api/agent-sessions/status').then((r) =>
        r.json(),
      )) as { session: SessionInfo | null }
      setSession(data.session)
      setHasSession(Boolean(data.session))
    } catch {
      /* keep current state on transient network error */
    }
  }, [])
  useSessionRealtime(userId, handleRealtimeChange)

  return { hasSession, session, refresh: check }
}
