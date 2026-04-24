import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAgentStatusRealtime } from '@/hooks/use-agent-status-realtime'

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
})

type Agent = {
  id: string
  persona_name: string
  specialist_type: string
  status: string
  container_name: string
  model_name?: string
  skills?: string[]
  agent_status?: string
  cooldown_until?: string
  locked_to_user?: string
  owner_user_id?: string | null
  deployment_type?: 'cloud_fleet' | 'user_vps' | 'user_tunnel'
}

const AGENT_COLORS: Record<string, string> = {
  'Harry Potter': '#f59e0b',
  'Hermione': '#8b5cf6',
}

type Mode = 'cloud' | 'vps' | 'tunnel' | 'local'

const VPS_INSTALL_SCRIPT =
  'curl -fsSL https://raw.githubusercontent.com/balaji-embedcentrum/hermes-adapter/main/scripts/install-studio-vps.sh | bash -s -- --domain your.domain.com --email you@example.com'
const TUNNEL_INSTALL_SCRIPT =
  'curl -fsSL https://raw.githubusercontent.com/balaji-embedcentrum/hermes-adapter/main/scripts/install-tunnel.sh | bash'

function AgentsPage() {
  const navigate = useNavigate()
  const localHermesUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCloudId, setSelectedCloudId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('cloud')

  const refreshAgents = useCallback(() => {
    fetch('/api/agents/list')
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refreshAgents()
    // Trigger a health check to get fresh statuses
    fetch('/api/agent-sessions/health-check').catch(() => {})
  }, [refreshAgents])

  // Realtime updates — when any agent's status changes, update local state
  const handleRealtimeUpdate = useCallback(
    (updated: { id: string; [key: string]: unknown }) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      )
    },
    [],
  )
  useAgentStatusRealtime(handleRealtimeUpdate)

  // Split agents into public fleet vs this user's personal agent
  const cloudAgents = useMemo(
    () => agents.filter((a) => !a.owner_user_id),
    [agents],
  )
  const personalAgent = useMemo(
    () => agents.find((a) => !!a.owner_user_id) ?? null,
    [agents],
  )

  const handleStartSession = async (agent: Agent) => {
    const agentStatus = agent.agent_status ?? 'available'
    if (agentStatus === 'in_use') {
      setSessionError(`${agent.persona_name} is currently in use. Try another agent.`)
      return
    }
    if (agentStatus === 'unavailable') {
      setSessionError(`${agent.persona_name} is offline.`)
      return
    }
    if (agentStatus === 'cooling_down') {
      setSessionError(`${agent.persona_name} is cooling down. Try again in a moment.`)
      return
    }

    setSelecting(true)
    setSessionError(null)
    try {
      const res = await fetch('/api/agent-sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        session?: { sessionId: string }
      }
      if (data.ok) {
        setSelectedCloudId(agent.id)
        refreshAgents()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('hermes:session-changed'))
          try {
            localStorage.setItem('hermes:session-changed', String(Date.now()))
          } catch {
            /* private mode etc. */
          }
        }
      } else {
        setSessionError(data.error ?? 'Failed to start session')
      }
    } catch {
      setSessionError('Failed to connect')
    }
    setSelecting(false)
  }

  // Continue gate — per mode
  const canContinue = useMemo(() => {
    if (mode === 'cloud') return selectedCloudId !== null
    if (mode === 'local') return localHermesUrl !== null
    if (mode === 'vps' || mode === 'tunnel') {
      return (
        personalAgent !== null &&
        personalAgent.deployment_type ===
          (mode === 'vps' ? 'user_vps' : 'user_tunnel')
      )
    }
    return false
  }, [mode, selectedCloudId, localHermesUrl, personalAgent])

  const handleContinue = () => {
    if (mode === 'local') {
      setShowFolderDialog(true)
    } else {
      navigate({ to: '/projects' })
    }
  }

  // Mode switching: clear cross-mode state so "Continue" state is honest
  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setSessionError(null)
    if (next !== 'cloud') setSelectedCloudId(null)
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: 'var(--theme-bg)', color: 'var(--theme-text)' }}
    >
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-1">Choose Your Agent</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--theme-muted)' }}>
          Pick one source. You can switch anytime.
        </p>

        <ModeRadioStrip mode={mode} onChange={switchMode} />

        <div className="mt-6">
          {mode === 'cloud' && (
            <CloudPanel
              agents={cloudAgents}
              loading={loading}
              selectedId={selectedCloudId}
              selecting={selecting}
              onSelect={handleStartSession}
            />
          )}
          {mode === 'vps' && (
            <PersonalAgentPanel
              kind="vps"
              personalAgent={personalAgent}
              onSaved={() => refreshAgents()}
            />
          )}
          {mode === 'tunnel' && (
            <PersonalAgentPanel
              kind="tunnel"
              personalAgent={personalAgent}
              onSaved={() => refreshAgents()}
            />
          )}
          {mode === 'local' && <LocalHermesSection onConnected={() => {}} />}
        </div>

        {sessionError && (
          <div className="mt-6 text-center">
            <p
              className="text-xs px-4 py-2 rounded-lg inline-block"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              {sessionError}
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className="px-8 py-3 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: canContinue ? 'var(--theme-accent)' : 'var(--theme-card)',
              color: canContinue ? '#fff' : 'var(--theme-muted)',
              border: canContinue ? 'none' : '1px solid var(--theme-border)',
              opacity: canContinue ? 1 : 0.6,
              cursor: canContinue ? 'pointer' : 'not-allowed',
            }}
          >
            Continue to Projects →
          </button>
          {!canContinue && (
            <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              {mode === 'cloud' && 'Pick a playground agent to continue'}
              {mode === 'vps' && 'Register your VPS agent to continue'}
              {mode === 'tunnel' && 'Register your tunnel agent to continue'}
              {mode === 'local' && 'Connect your local Hermes adapter to continue'}
            </p>
          )}
        </div>
      </div>

      {showFolderDialog && (
        <WorkspaceFolderDialog
          onConfirm={() => {
            setShowFolderDialog(false)
            navigate({ to: '/projects' })
          }}
          onCancel={() => setShowFolderDialog(false)}
        />
      )}
    </div>
  )
}

/* ── Mode Radio Strip ──────────────────────────────────────────────── */

const MODE_META: Record<Mode, { label: string; sub: string; icon: string; pill: string; pillColor: string }> = {
  cloud:  { label: 'Cloud Playground', sub: 'Shared, experimental',  icon: '☁',  pill: 'Try',   pillColor: '#8b5cf6' },
  vps:    { label: 'Your VPS',         sub: 'On your server',    icon: '🌐', pill: 'BYO',   pillColor: '#10b981' },
  tunnel: { label: 'Local via Tunnel', sub: 'Cloudflare tunnel', icon: '🔗', pill: 'BYO',   pillColor: '#10b981' },
  local:  { label: 'Local Direct',     sub: 'Chrome/Edge/FF',    icon: '💻', pill: 'Free',  pillColor: '#14b8a6' },
}

function ModeRadioStrip({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const modes: Mode[] = ['cloud', 'vps', 'tunnel', 'local']
  return (
    <div
      role="radiogroup"
      aria-label="Agent source"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {modes.map((m) => {
        const meta = MODE_META[m]
        const selected = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(m)}
            className="text-left rounded-xl p-4 transition-all"
            style={{
              background: selected ? 'var(--theme-card)' : 'var(--theme-bg)',
              border: selected
                ? `2px solid var(--theme-accent)`
                : '1px solid var(--theme-border)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl" aria-hidden>{meta.icon}</span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${meta.pillColor}22`, color: meta.pillColor }}
              >
                {meta.pill}
              </span>
              <span
                aria-hidden
                className="ml-auto inline-block w-3 h-3 rounded-full"
                style={{
                  background: selected ? 'var(--theme-accent)' : 'transparent',
                  border: selected
                    ? 'none'
                    : '2px solid var(--theme-border)',
                }}
              />
            </div>
            <div className="font-semibold text-sm" style={{ color: 'var(--theme-text)' }}>
              {meta.label}
            </div>
            <div className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              {meta.sub}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ── Cloud Panel ───────────────────────────────────────────────────── */

function CloudPanel({
  agents,
  loading,
  selectedId,
  selecting,
  onSelect,
}: {
  agents: Array<Agent>
  loading: boolean
  selectedId: string | null
  selecting: boolean
  onSelect: (a: Agent) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3" style={{ color: 'var(--theme-muted)' }}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        Loading agents...
      </div>
    )
  }
  if (agents.length === 0) {
    return (
      <div className="text-center py-10" style={{ color: 'var(--theme-muted)' }}>
        <p className="text-sm">No cloud agents available</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {agents.map((agent) => {
        const color = AGENT_COLORS[agent.persona_name] ?? '#14b8a6'
        const skills = agent.skills ?? [agent.specialist_type]
        const model = agent.model_name ?? 'Unknown'
        const isSelected = selectedId === agent.id
        const agentStatus = agent.agent_status ?? 'available'
        const isAvailable = agentStatus === 'available'
        const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
          available:    { bg: 'rgba(16,185,129,0.15)',  color: '#10b981', label: 'Available' },
          in_use:       { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444', label: 'In Use' },
          cooling_down: { bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b', label: 'Cooling Down' },
          unavailable:  { bg: 'rgba(107,114,128,0.15)', color: '#6b7280', label: 'Offline' },
        }
        const st = statusConfig[agentStatus] ?? statusConfig.available
        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent)}
            disabled={selecting || (!isAvailable && !isSelected)}
            className="text-left rounded-xl p-5 transition-all hover:scale-[1.01]"
            style={{
              background: 'var(--theme-card)',
              border: isSelected ? `2px solid ${color}` : '1px solid var(--theme-border)',
              opacity: isAvailable || isSelected ? 1 : 0.6,
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ background: `${color}20`, color }}
              >
                {agent.persona_name.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: 'var(--theme-text)' }}>
                  {agent.persona_name}
                </div>
                <div className="text-xs" style={{ color: 'var(--theme-muted)' }}>
                  {model}
                </div>
              </div>
              <div className="ml-auto">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.color }}>
                  {st.label}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {skills.map((skill) => (
                <span key={skill} className="text-[11px] px-2 py-0.5 rounded" style={{ background: `${color}15`, color }}>
                  {skill}
                </span>
              ))}
            </div>
            {isSelected && (
              <div className="text-xs font-medium" style={{ color }}>
                ✓ Session active — chat will use this agent
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── Personal Agent Panel (VPS + Tunnel) ───────────────────────────── */

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'error'; reason: string; message: string }

function PersonalAgentPanel({
  kind,
  personalAgent,
  onSaved,
}: {
  kind: 'vps' | 'tunnel'
  personalAgent: Agent | null
  onSaved: () => void
}) {
  const requiredType = kind === 'vps' ? 'user_vps' : 'user_tunnel'
  const installScript = kind === 'vps' ? VPS_INSTALL_SCRIPT : TUNNEL_INSTALL_SCRIPT
  const title = kind === 'vps' ? 'Your VPS agent' : 'Local-via-Cloudflare agent'
  const subtitle =
    kind === 'vps'
      ? 'Run the script on your server, paste the output below. The URL is permanent.'
      : 'Run the script on your machine, paste the output below. The URL rotates when you restart the tunnel — re-paste if that happens.'

  // We own the row if deployment_type matches. If the user registered a
  // VPS agent earlier and now switched to Tunnel (or vice versa), show
  // the form pre-filled with existing values but clearly labelled as a
  // replacement — submitting updates the same row with the new type.
  const wrongType =
    personalAgent !== null && personalAgent.deployment_type !== requiredType

  const [name, setName] = useState(
    personalAgent && !wrongType ? personalAgent.persona_name : '',
  )
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })

  useEffect(() => {
    // When personalAgent changes (refresh after save), sync name field.
    // URL + apiKey never pre-fill — user always pastes fresh from script
    // output (tunnel URLs rotate, and we don't want the key in JS state).
    if (personalAgent && !wrongType) {
      setName(personalAgent.persona_name)
    }
  }, [personalAgent, wrongType])

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedUrl = url.trim().replace(/\/$/, '')
    if (!trimmedName || !trimmedUrl) {
      setSaveError('Name and URL are required')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/agents/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          url: trimmedUrl,
          apiKey: apiKey.trim() || undefined,
          deploymentType: requiredType,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setSaveError(data.error ?? 'Failed to save')
      } else {
        setApiKey('')
        onSaved()
      }
    } catch {
      setSaveError('Network error')
    }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!personalAgent) return
    setTest({ kind: 'testing' })
    try {
      const res = await fetch('/api/agents/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: personalAgent.id }),
      })
      const data = await res.json()
      if (data.ok) {
        setTest({ kind: 'ok', latencyMs: data.latencyMs })
      } else {
        setTest({ kind: 'error', reason: data.reason, message: data.message })
      }
    } catch {
      setTest({ kind: 'error', reason: 'network', message: 'Could not reach /api/agents/test' })
    }
  }

  const copyScript = () => {
    navigator.clipboard.writeText(installScript).catch(() => {})
  }

  const registered = personalAgent !== null && !wrongType

  const unreachableReasons =
    kind === 'vps'
      ? [
          'VPS firewall blocks HTTPS on port 443',
          'DNS A record for the domain is missing or stale',
          "TLS cert didn't issue — check the install-studio-vps.sh output",
          'Model API key expired or rate-limited on the agent',
        ]
      : [
          'Terminal running install-tunnel.sh was closed',
          'Cloudflare rotated your tunnel URL — re-run the script, re-paste the URL',
          "Adapter crashed — check ~/.hermes-adapter/logs",
          'Model API key expired or rate-limited on the agent',
        ]

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
          style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
        >
          {kind === 'vps' ? '🌐' : '🔗'}
        </div>
        <div>
          <div className="font-semibold text-sm" style={{ color: 'var(--theme-text)' }}>
            {title}
          </div>
          <div className="text-xs" style={{ color: 'var(--theme-muted)' }}>
            {subtitle}
          </div>
        </div>
      </div>

      {/* Install snippet */}
      <div
        className="rounded-lg p-3 mb-4 flex items-start gap-2"
        style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
      >
        <code className="flex-1 text-[11px] leading-relaxed break-all font-mono" style={{ color: 'var(--theme-text)' }}>
          {installScript}
        </code>
        <button
          type="button"
          onClick={copyScript}
          className="shrink-0 text-[11px] px-2 py-1 rounded"
          style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}
        >
          Copy
        </button>
      </div>

      {wrongType && (
        <div
          className="text-[11px] mb-3 p-2 rounded-lg"
          style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            color: '#fbbf24',
          }}
        >
          You currently have a {personalAgent?.deployment_type === 'user_vps' ? 'VPS' : 'tunnel'} agent registered.
          Saving below will replace it.
        </div>
      )}

      {/* Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--theme-muted)' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="primary"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--theme-muted)' }}>
            URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={kind === 'vps' ? 'https://agent.your-domain.com' : 'https://xxx.trycloudflare.com'}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
            style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--theme-muted)' }}>
          API key {registered ? '(leave blank to keep existing)' : ''}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Bearer token from the install script"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
          style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
        />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: 'var(--theme-accent)',
            color: '#fff',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : registered ? 'Update' : 'Register'}
        </button>
        {registered && (
          <button
            type="button"
            onClick={handleTest}
            disabled={test.kind === 'testing'}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          >
            {test.kind === 'testing' ? 'Testing…' : 'Test'}
          </button>
        )}
        {registered && (
          <span
            className="text-[11px] px-2 py-1 rounded-full font-medium"
            style={{
              background: 'rgba(16,185,129,0.15)',
              color: '#10b981',
            }}
          >
            Registered
          </span>
        )}
      </div>

      {saveError && (
        <div className="text-[11px] mb-3" style={{ color: '#ef4444' }}>
          {saveError}
        </div>
      )}

      {test.kind === 'ok' && (
        <div className="text-xs" style={{ color: '#10b981' }}>
          ✓ Reachable ({test.latencyMs} ms)
        </div>
      )}
      {test.kind === 'error' && (
        <div
          className="text-[11px] mt-2 p-3 rounded-lg"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: '#ef4444',
          }}
        >
          <div className="font-semibold mb-1">Agent not reachable — {test.message}</div>
          <div style={{ color: 'var(--theme-muted)' }}>Common causes:</div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5" style={{ color: 'var(--theme-muted)' }}>
            {unreachableReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── Local Hermes Section ─────────────────────────────────────────── */

function LocalHermesSection({ onConnected }: { onConnected: () => void }) {
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const setLocalHermesUrl = useWorkspaceStore(s => s.setLocalHermesUrl)
  const [url, setUrl] = useState(localHermesUrl ?? 'http://127.0.0.1:9001')
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'connected' | 'error'>('idle')
  // Default open only when already connected — otherwise collapse to
  // give cloud agents the screen real estate.
  const [expanded, setExpanded] = useState(localHermesUrl !== null)

  useEffect(() => {
    if (localHermesUrl) {
      testConnection(localHermesUrl)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const testConnection = async (testUrl: string) => {
    setTesting(true)
    setStatus('idle')
    try {
      const res = await fetch(`${testUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      setStatus(res.ok ? 'connected' : 'error')
    } catch {
      setStatus('error')
    }
    setTesting(false)
  }

  const handleEnable = async () => {
    const trimmed = url.trim().replace(/\/$/, '')
    if (!trimmed) return
    await testConnection(trimmed)
    setLocalHermesUrl(trimmed)
    onConnected()
  }

  const handleDisable = () => {
    setLocalHermesUrl(null)
    setStatus('idle')
  }

  const isEnabled = localHermesUrl !== null

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--theme-card)',
        border: isEnabled && status === 'connected'
          ? '2px solid #10b981'
          : '1px solid var(--theme-border)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 w-full text-left"
        aria-expanded={expanded}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
          style={{ background: 'rgba(20,184,166,0.12)', color: '#14b8a6' }}
        >
          H
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm" style={{ color: 'var(--theme-text)' }}>
              Local Hermes Agent
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
            >
              Free
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--theme-muted)' }}
            >
              Advanced
            </span>
          </div>
          <div className="text-xs" style={{ color: 'var(--theme-muted)' }}>
            Run Hermes on your machine — files stay local, no cloud needed
          </div>
        </div>
        {isEnabled && status === 'connected' && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
          >
            connected
          </span>
        )}
        {isEnabled && status === 'error' && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
          >
            unreachable
          </span>
        )}
        <span
          aria-hidden
          className="text-sm transition-transform"
          style={{
            color: 'var(--theme-muted)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ›
        </span>
      </button>

      {!expanded ? null : <>

      <div className="flex items-center gap-2 mt-3 mb-3">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:9001"
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: 'var(--theme-bg)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
          }}
        />
      </div>

      {/* Browser compatibility warning.
          Safari blocks mixed content (https page → http://127.0.0.1) even
          for localhost — browsers need the target origin to be HTTPS or to
          special-case localhost (Chrome/Firefox/Edge do, Safari doesn't). */}
      <div
        className="flex items-start gap-2 text-[11px] mb-3 p-2 rounded-lg"
        style={{
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.2)',
          color: '#fbbf24',
        }}
      >
        <span>⚠</span>
        <span>
          Local agents only work in <strong>Chrome, Edge, Firefox, Brave, Arc, or Opera</strong>.
          Safari blocks connections from this HTTPS page to <code>http://127.0.0.1</code>.
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!isEnabled ? (
          <button
            onClick={handleEnable}
            disabled={testing || !url.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: '#14b8a6',
              color: '#fff',
              opacity: !url.trim() ? 0.5 : 1,
            }}
          >
            {testing ? 'Testing...' : 'Connect'}
          </button>
        ) : (
          <>
            <button
              onClick={() => testConnection(localHermesUrl)}
              disabled={testing}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button
              onClick={handleDisable}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {isEnabled && status === 'connected' && (
        <div className="text-xs mt-3 font-medium" style={{ color: '#10b981' }}>
          ✓ Active — chat and file operations go directly to your local agent
        </div>
      )}
      {isEnabled && status === 'error' && (
        <div className="text-xs mt-3" style={{ color: '#ef4444' }}>
          Cannot reach {localHermesUrl}. Make sure the adapter is running: <code className="text-[11px]">hermes-adapter up</code>
        </div>
      )}

      <div className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
        First time?{' '}
        <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-bg)' }}>
          curl -fsSL https://raw.githubusercontent.com/balaji-embedcentrum/hermes-adapter/main/scripts/install.sh | bash
        </code>
        <br />
        Then: <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-bg)' }}>hermes-adapter agent add alpha --model anthropic/claude-sonnet-4.6 --prompt-key && hermes-adapter up</code>
      </div>
      </>}
    </div>
  )
}

/* ── Workspace Folder Dialog ──────────────────────────────────────── */

type WorkspaceEntry = { name: string; path: string; abs_path: string }

function WorkspaceFolderDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const savedLocalRoot = useWorkspaceStore(s => s.localWorkspaceRoot)
  const setLocalWorkspaceRoot = useWorkspaceStore(s => s.setLocalWorkspaceRoot)
  const [workspaceRoot, setWorkspaceRoot] = useState(savedLocalRoot ?? '')
  const [projects, setProjects] = useState<WorkspaceEntry[]>([])
  const [scanning, setScanning] = useState(true)
  const [autoDiscoveryFailed, setAutoDiscoveryFailed] = useState(false)

  // Try the local Hermes agent's /ws endpoint for auto-discovery. Older
  // Hermes versions don't expose /ws — we fall back to manual folder entry.
  useEffect(() => {
    if (!localHermesUrl) return
    setScanning(true)
    setAutoDiscoveryFailed(false)
    fetch(`${localHermesUrl}/ws`, { signal: AbortSignal.timeout(10_000) })
      .then(r => {
        if (!r.ok) throw new Error(`ws endpoint returned ${r.status}`)
        return r.json()
      })
      .then((data: { root?: string; workspaces?: WorkspaceEntry[] }) => {
        if (data.root) setWorkspaceRoot(data.root)
        setProjects(data.workspaces ?? [])
      })
      .catch(() => setAutoDiscoveryFailed(true))
      .finally(() => setScanning(false))
  }, [localHermesUrl])

  const handleConfirm = () => {
    const trimmed = workspaceRoot.trim().replace(/\/$/, '')
    if (!trimmed) return
    setLocalWorkspaceRoot(trimmed)
    onConfirm()
  }

  const canConfirm = workspaceRoot.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden
      />
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
      >
        <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--theme-text)' }}>
          Local Workspace
        </h2>
        <p className="text-xs mb-5" style={{ color: 'var(--theme-muted)' }}>
          Your local Hermes agent stores projects here:
        </p>

        {/* Workspace folder — editable. Auto-discovered from Hermes /ws if
            the endpoint exists; otherwise the user types an absolute path. */}
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--theme-muted)' }}>
          Folder (absolute path)
        </label>
        <input
          type="text"
          value={workspaceRoot}
          onChange={(e) => setWorkspaceRoot(e.target.value)}
          placeholder="/Users/you/hermes-workspaces"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full px-3 py-2.5 rounded-lg text-sm mb-4 font-mono"
          style={{
            background: 'var(--theme-bg)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            outline: 'none',
          }}
        />

        {scanning && (
          <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: 'var(--theme-muted)' }}>
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            Looking up workspace from local agent...
          </div>
        )}

        {/* Existing projects (only shown if auto-discovery worked) */}
        {projects.length > 0 && (
          <div className="mb-4">
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--theme-muted)' }}>
              Existing Projects ({projects.length})
            </label>
            <div
              className="rounded-lg max-h-48 overflow-y-auto"
              style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
            >
              {projects.map(p => (
                <div
                  key={p.abs_path}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                  style={{ borderBottom: '1px solid var(--theme-border)' }}
                >
                  <span>📁</span>
                  <span style={{ color: 'var(--theme-text)' }}>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {autoDiscoveryFailed && (
          <div className="text-[11px] mb-4 leading-relaxed rounded-lg px-3 py-2" style={{ color: 'var(--theme-muted)', background: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
            Your local Hermes agent doesn{"'"}t expose the workspace listing endpoint. Type the absolute path to your workspace folder above — this is the same value as <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-card)' }}>HERMES_WORKSPACE_DIR</code> in <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-card)' }}>~/.hermes/.env</code> (or <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-card)' }}>~/.hermes</code> if unset).
          </div>
        )}

        <div className="text-[11px] mb-5 leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
          To change this folder, set <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-bg)' }}>HERMES_WORKSPACE_DIR</code> in <code className="px-1 py-0.5 rounded" style={{ background: 'var(--theme-bg)' }}>~/.hermes/.env</code> and restart the agent.
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ color: 'var(--theme-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-6 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--theme-accent)', color: '#fff' }}
          >
            Open Projects →
          </button>
        </div>
      </div>
    </div>
  )
}
