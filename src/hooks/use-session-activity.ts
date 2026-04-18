/**
 * useSessionActivity — tracks user activity and pings the server
 * to keep the agent session alive. If the user is idle for 15+ min,
 * the server will end the session on the next check.
 *
 * Also handles: beforeunload (tab close), visibilitychange (tab hidden).
 * Sends session end request when user navigates away.
 */
import { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'

const ACTIVITY_PING_INTERVAL = 60_000 // ping every 60s when active

export function useSessionActivity() {
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const lastActivityRef = useRef(Date.now())
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Skip for local agent — no session management
    if (localHermesUrl) return

    // Track user activity
    const markActive = () => { lastActivityRef.current = Date.now() }

    window.addEventListener('mousemove', markActive, { passive: true })
    window.addEventListener('keydown', markActive, { passive: true })
    window.addEventListener('click', markActive, { passive: true })
    window.addEventListener('scroll', markActive, { passive: true })

    // Ping server periodically to update last_activity_at
    pingIntervalRef.current = setInterval(() => {
      // Only ping if user was active in the last interval
      const timeSinceActivity = Date.now() - lastActivityRef.current
      if (timeSinceActivity < ACTIVITY_PING_INTERVAL * 2) {
        fetch('/api/agent-sessions/status').catch(() => {})
      }
    }, ACTIVITY_PING_INTERVAL)

    // End session on tab close / navigate away
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload
      navigator.sendBeacon(
        '/api/agent-sessions/end',
        new Blob([JSON.stringify({ reason: 'user_ended' })], { type: 'application/json' }),
      )
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('keydown', markActive)
      window.removeEventListener('click', markActive)
      window.removeEventListener('scroll', markActive)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
    }
  }, [localHermesUrl])
}
