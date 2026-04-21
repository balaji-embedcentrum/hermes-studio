/**
 * SessionTimer — countdown timer in the header.
 * Data flow:
 *   1. On mount: fetch current session once from /api/agent-sessions/status
 *   2. Subscribe to agent_sessions realtime — instant updates when session changes
 *   3. Tick locally every second using `expires_at - Date.now()` for display
 *
 * No polling. Server's expires_at is the single source of truth.
 * Hidden when using local agent.
 */
import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSessionRealtime } from '@/hooks/use-session-realtime'

type SessionData = {
  sessionId: string
  agentName: string
  expiresAt: string
}

function formatTime(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function SessionTimer() {
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const [session, setSession] = useState<SessionData | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [ended, setEnded] = useState(false)

  // Don't render for local agent mode
  if (localHermesUrl) return null

  // Initial fetch on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth-check')
      .then(r => r.json())
      .then(data => { if (!cancelled && data.userId) setUserId(data.userId) })
      .catch(() => {})
    fetch('/api/agent-sessions/status')
      .then(r => r.json())
      .then((data: { session: (SessionData & { timeRemainingMs: number }) | null }) => {
        if (cancelled) return
        if (data.session) {
          setSession({
            sessionId: data.session.sessionId,
            agentName: data.session.agentName,
            expiresAt: data.session.expiresAt,
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Realtime — re-query the authoritative status endpoint on ANY change
  // to this user's agent_sessions rows. Switching agents fires two
  // events in order (old session ended, new session inserted); processing
  // only the first would wrongly clear the timer while a new session is
  // already active. Let the server decide.
  const handleRealtimeChange = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-sessions/status')
      const data = (await res.json()) as { session: SessionData | null }
      if (data.session) {
        setSession(data.session)
        setEnded(false)
      } else {
        setSession(null)
        setEnded(true)
      }
    } catch {
      /* keep current state on transient network error */
    }
  }, [])
  useSessionRealtime(userId, handleRealtimeChange)

  // Client-side tick every second — uses expiresAt as source of truth
  useEffect(() => {
    if (!session) { setTimeLeft(0); return }
    const compute = () => {
      const remaining = new Date(session.expiresAt).getTime() - Date.now()
      setTimeLeft(Math.max(0, remaining))
      if (remaining <= 0) setEnded(true)
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [session])

  const handleEndSession = async () => {
    try {
      await fetch('/api/agent-sessions/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user_ended' }),
      })
      // Realtime subscription will fire and update state, but set immediately for snappy UX
      setSession(null)
      setEnded(true)
    } catch {}
  }

  if (ended && !session) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
      >
        Session ended
        <button onClick={() => setEnded(false)} className="ml-1 opacity-60 hover:opacity-100">
          x
        </button>
      </div>
    )
  }

  if (!session) return null

  const isWarning = timeLeft <= 5 * 60 * 1000
  const isUrgent = timeLeft <= 2 * 60 * 1000

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
      style={{
        background: isUrgent ? 'rgba(239,68,68,0.1)' : isWarning ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.08)',
        color: isUrgent ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981',
      }}
    >
      <span className="opacity-70">{session.agentName}</span>
      <span className="font-mono">{formatTime(timeLeft)}</span>
      <button
        onClick={handleEndSession}
        className="ml-1 opacity-40 hover:opacity-100 text-[10px]"
        title="End session"
      >
        End
      </button>
    </div>
  )
}
