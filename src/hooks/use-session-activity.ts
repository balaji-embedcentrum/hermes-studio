/**
 * useSessionActivity — tracks user activity and pings the server
 * to keep the agent session alive. If the user is idle for IDLE_TIMEOUT_MS,
 * the server's validateSession() will end the session on the next write.
 *
 * Does NOT end the session on tab close or refresh — beforeunload fires
 * on every browser refresh / navigation, which would (and did) destroy
 * the user's session every time they reloaded the page. Lifecycle is
 * server-managed: idle reclaim, expires_at, or explicit user End click.
 */
import { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'

const ACTIVITY_PING_INTERVAL = 60_000 // ping every 60s when active

export function useSessionActivity() {
  const localHermesUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const lastActivityRef = useRef(Date.now())
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Skip for local agent — no session management
    if (localHermesUrl) return

    // Track user activity
    const markActive = () => {
      lastActivityRef.current = Date.now()
    }

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

    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('keydown', markActive)
      window.removeEventListener('click', markActive)
      window.removeEventListener('scroll', markActive)
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current)
    }
  }, [localHermesUrl])
}
