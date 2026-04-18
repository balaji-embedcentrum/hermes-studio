/**
 * useSessionRealtime — subscribes to Supabase realtime changes on
 * the agent_sessions table for the current user.
 *
 * Calls onSessionChange whenever the user's session is created, updated,
 * or ended (status changes from 'active' to 'ended', etc.).
 *
 * Requires: ALTER PUBLICATION supabase_realtime ADD TABLE agent_sessions
 */
import { useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'

type SessionRow = {
  id: string
  user_id: string
  agent_id: string
  started_at: string
  expires_at: string
  ended_at: string | null
  status: 'active' | 'ended' | 'expired'
  last_activity_at: string
  [key: string]: unknown
}

export function useSessionRealtime(
  userId: string | null | undefined,
  onSessionChange: (session: SessionRow | null) => void,
) {
  // Unique per hook instance — multiple components can subscribe without colliding
  // on Supabase's shared channel registry (channel names are reused if identical).
  const instanceIdRef = useRef<string>('')
  if (!instanceIdRef.current) {
    instanceIdRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }

  useEffect(() => {
    if (!userId) return

    const supabase = getSupabaseBrowser()
    const channel = supabase
      .channel(`session-realtime-${userId}-${instanceIdRef.current}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*', // INSERT | UPDATE | DELETE
          schema: 'public',
          table: 'agent_sessions',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: SessionRow | null; old: SessionRow | null; eventType: string }) => {
          const row = payload.new ?? payload.old
          if (!row) return

          // Only care about active sessions — if one just ended, notify null
          if (row.status !== 'active') {
            onSessionChange(null)
          } else {
            onSessionChange(row)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, onSessionChange])
}
