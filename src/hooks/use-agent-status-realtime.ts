/**
 * useAgentStatusRealtime — subscribes to Supabase realtime changes on
 * the agent_instances table. Calls the callback with the updated agent record
 * whenever ANY field changes (status, cooldown_until, locked_to_user, etc.).
 *
 * Uses Supabase's postgres_changes replication — requires:
 *   ALTER PUBLICATION supabase_realtime ADD TABLE agent_instances;
 */
import { useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'

type AgentRow = {
  id: string
  agent_status?: string
  cooldown_until?: string | null
  locked_to_user?: string | null
  status?: string
  [key: string]: unknown
}

export function useAgentStatusRealtime(onUpdate: (agent: AgentRow) => void) {
  const instanceIdRef = useRef<string>('')
  if (!instanceIdRef.current) {
    instanceIdRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    const channel = supabase
      .channel(`agent-status-realtime-${instanceIdRef.current}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_instances',
        },
        (payload: { new: AgentRow }) => {
          onUpdate(payload.new)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [onUpdate])
}
