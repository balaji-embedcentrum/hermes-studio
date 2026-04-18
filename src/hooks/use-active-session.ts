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
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Initial fetch
  const check = useCallback(async () => {
    if (localHermesUrl) {
      setHasSession(true)
      return
    }
    try {
      const [authRes, sessRes] = await Promise.all([
        fetch('/api/auth-check').then(r => r.json()),
        fetch('/api/agent-sessions/status').then(r => r.json()),
      ])
      if (authRes.userId) setUserId(authRes.userId)
      setSession(sessRes.session)
      setHasSession(Boolean(sessRes.session))
    } catch {
      setHasSession(false)
    }
  }, [localHermesUrl])

  useEffect(() => {
    check()
  }, [check])

  // Realtime — update when session row changes
  const handleRealtimeChange = useCallback((row: { status?: string } | null) => {
    if (!row || row.status !== 'active') {
      setSession(null)
      setHasSession(false)
    } else {
      setHasSession(true)
      // Fetch full session data (realtime row doesn't include agent name)
      fetch('/api/agent-sessions/status')
        .then(r => r.json())
        .then((data: { session: SessionInfo | null }) => {
          setSession(data.session)
        })
        .catch(() => {})
    }
  }, [])
  useSessionRealtime(userId, handleRealtimeChange)

  return { hasSession, session, refresh: check }
}
