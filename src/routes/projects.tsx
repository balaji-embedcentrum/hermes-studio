import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'
import { useWorkspaceStore } from '@/stores/workspace-store'

export const Route = createFileRoute('/projects')({
  component: ProjectsPage,
})

type GitHubRepo = {
  id: number
  full_name: string
  name: string
  description: string | null
  private: boolean
  updated_at: string
  language: string | null
  stargazers_count: number
}

type LocalWorkspace = {
  name: string
  path: string
  lastAccessed?: string
}

function ProjectsPage() {
  const navigate = useNavigate()
  const localHermesUrl = useWorkspaceStore(s => s.localHermesUrl)
  const isLocalMode = localHermesUrl !== null
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [githubLogin, setGithubLogin] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cloning, setCloning] = useState<{ repoFull: string; lines: string[] } | null>(null)
  const [activeTab, setActiveTab] = useState<'github' | 'local'>(isLocalMode ? 'local' : 'github')
  const [hasAgent, setHasAgent] = useState(true) // optimistic, checked on load
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalWorkspace[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  // Guard: redirect to /agents if no agent is selected (remote mode only)
  useEffect(() => {
    if (isLocalMode) return // local agent always ok
    fetch('/api/agent-sessions/status')
      .then(r => r.json())
      .then(data => {
        // If no active session and not local mode, user needs to select an agent first
        if (!data.session) {
          setHasAgent(false)
          navigate({ to: '/agents' })
        }
      })
      .catch(() => {})
  }, [isLocalMode, navigate])

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/auth-check')
        const auth = await res.json()
        if (!auth.authenticated) {
          setLoading(false)
          return
        }
        setGithubLogin(auth.githubLogin)

        // Fetch repos via server proxy (token is server-side only)
        const reposRes = await fetch('/api/github/repos')
        if (!reposRes.ok) throw new Error('Failed to load repositories')
        const data = await reposRes.json()
        setRepos(data.repos ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  // Load local workspaces — from local Hermes agent when connected, else from Supabase
  useEffect(() => {
    if (activeTab !== 'local') return
    setLocalLoading(true)

    if (localHermesUrl) {
      // Local mode: call the agent's /ws endpoint directly from browser
      fetch(`${localHermesUrl}/ws`, { signal: AbortSignal.timeout(10_000) })
        .then(r => r.json())
        .then((data: { workspaces?: Array<{ name: string; path: string; abs_path: string }> }) => {
          const ws = (data.workspaces ?? []).map(w => ({
            name: w.name,
            path: w.abs_path,
          }))
          setLocalWorkspaces(ws)
        })
        .catch(() => setLocalWorkspaces([]))
        .finally(() => setLocalLoading(false))
    } else {
      // Remote mode: fetch from Supabase via server API
      fetch('/api/workspaces/list')
        .then(r => r.json())
        .then((data: { workspaces?: Array<{ repo_full: string; workspace_path: string; last_accessed: string | null }> }) => {
          const ws = (data.workspaces ?? []).map(w => ({
            name: w.repo_full,
            path: w.workspace_path,
            lastAccessed: w.last_accessed ?? undefined,
          }))
          setLocalWorkspaces(ws)
        })
        .catch(() => setLocalWorkspaces([]))
        .finally(() => setLocalLoading(false))
    }
  }, [activeTab, localHermesUrl])

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    try {
      if (localHermesUrl) {
        // Local mode: create empty workspace via local agent
        const res = await fetch(`${localHermesUrl}/ws/${encodeURIComponent(name)}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empty: true }),
        })
        const data = await res.json() as { status: string; path?: string }
        setShowNewProject(false)
        setNewProjectName('')
        if (data.status === 'ok' && data.path) {
          navigate({ to: '/files', search: { path: data.path } })
        }
      } else {
        // Remote mode: create via server API
        const res = await fetch('/api/workspaces/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const data = await res.json() as { ok?: boolean; path?: string; error?: string }
        setShowNewProject(false)
        setNewProjectName('')
        if (data.ok && data.path) {
          navigate({ to: '/files', search: { path: data.path } })
        }
      }
    } catch { /* ignore */ }
  }

  const filtered = repos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const handleSelectRepo = async (repo: GitHubRepo) => {
    setCloning({ repoFull: repo.full_name, lines: ['Opening workspace…'] })

    if (localHermesUrl) {
      // ── Local mode: clone directly via local Hermes agent ──
      const cloneUrl = `https://github.com/${repo.full_name}.git`

      setCloning(c => c ? { ...c, lines: [...c.lines, `Cloning ${repo.full_name} via local agent...`] } : null)

      try {
        // Use repo.name — local agent clones into HERMES_WORKSPACE_DIR/{owner}/{repo}
        const res = await fetch(`${localHermesUrl}/ws/${encodeURIComponent(repo.name)}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cloneUrl, branch: 'main' }),
          signal: AbortSignal.timeout(120_000),
        })
        const data = await res.json() as { status: string; action?: string; path?: string; message?: string }

        if (data.status === 'ok' && data.path) {
          setCloning(c => c ? { ...c, lines: [...c.lines, `${data.action === 'cloned' ? 'Cloned' : 'Pulled'} successfully`] } : null)
          setCloning(null)
          navigate({ to: '/files', search: { path: data.path } })
        } else {
          setCloning(c => c ? { ...c, lines: [...c.lines, `Error: ${data.message || 'Clone failed'}`] } : null)
          setTimeout(() => setCloning(null), 3000)
        }
      } catch (e) {
        setCloning(c => c ? { ...c, lines: [...c.lines, `Error: ${e instanceof Error ? e.message : 'Clone failed'}`] } : null)
        setTimeout(() => setCloning(null), 3000)
      }
      return
    }

    // ── Remote mode: clone via server APIs ──
    // Create or retrieve workspace DB record
    const openRes = await fetch('/api/workspaces/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_full: repo.full_name, repo_url: `https://github.com/${repo.full_name}` }),
    })
    if (!openRes.ok) {
      setCloning(null)
      return
    }
    const { workspace_id } = await openRes.json() as { workspace_id: string }

    // Clone or check if already ready (SSE stream)
    const cloneRes = await fetch('/api/workspaces/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id }),
    })

    // Already cloned — JSON response
    if (cloneRes.headers.get('content-type')?.includes('application/json')) {
      const { status, path: wsPath } = await cloneRes.json() as { status: string; path: string }
      setCloning(null)
      if (status === 'ready') {
        navigate({ to: '/files', search: { path: wsPath } })
      }
      return
    }

    // Streaming SSE clone progress
    const reader = cloneRes.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) { setCloning(null); return }

    let wsPath = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const msg = JSON.parse(line.slice(6)) as { type: string; message: string }
          if (msg.type === 'ready') {
            wsPath = msg.message
          } else if (msg.type === 'error') {
            setCloning((c) => c ? { ...c, lines: [...c.lines, `Error: ${msg.message}`] } : null)
          } else {
            setCloning((c) => c ? { ...c, lines: [...c.lines, msg.message] } : null)
          }
        } catch { /* ignore malformed */ }
      }
    }

    setCloning(null)
    if (wsPath) {
      navigate({ to: '/files', search: { path: wsPath } })
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/'
  }

  const handleSwitchAccount = async () => {
    // Sign out of Hermes Studio
    await fetch('/api/auth/logout', { method: 'POST' })
    // Redirect to GitHub logout — user signs out of GitHub, then can sign in with different account
    window.location.href = 'https://github.com/logout'
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--theme-bg)', color: 'var(--theme-text)' }}
    >
      {/* Clone progress overlay */}
      {cloning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80 shrink-0" />
              <span className="font-semibold text-sm" style={{ color: 'var(--theme-text)' }}>
                {cloning.repoFull}
              </span>
            </div>
            <div className="rounded-xl p-3 font-mono text-xs space-y-1 max-h-48 overflow-y-auto" style={{ background: 'var(--theme-bg)' }}>
              {cloning.lines.map((line, i) => (
                <div key={i} style={{ color: 'var(--theme-muted)' }}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div
        className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-sidebar)' }}
      >
        <div className="flex items-center gap-3">
          <img src="/hermes-crest.svg" alt="Hermes Studio" className="h-8 w-8 rounded-lg" style={{ filter: 'invert(1) brightness(2)' }} />
          <span className="font-semibold text-lg" style={{ color: 'var(--theme-text)' }}>
            Hermes Studio
          </span>
        </div>
        <div className="flex items-center gap-4">
          {githubLogin && (
            <span className="text-sm" style={{ color: 'var(--theme-muted)' }}>
              @{githubLogin}
            </span>
          )}
          <button
            onClick={handleSwitchAccount}
            className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ color: 'var(--theme-muted)' }}
          >
            Switch Account
          </button>
          <button
            onClick={handleLogout}
            className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--theme-text)' }}>
          Projects
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--theme-muted)' }}>
          Open a GitHub repository or a local workspace
        </p>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-5 rounded-xl p-1" style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}>
          <button
            onClick={() => setActiveTab('github')}
            className="flex-1 text-sm py-2 rounded-lg font-medium transition-colors"
            style={{
              background: activeTab === 'github' ? 'var(--theme-accent)' : 'transparent',
              color: activeTab === 'github' ? '#fff' : 'var(--theme-muted)',
            }}
          >
            GitHub Repos
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className="flex-1 text-sm py-2 rounded-lg font-medium transition-colors"
            style={{
              background: activeTab === 'local' ? 'var(--theme-accent)' : 'transparent',
              color: activeTab === 'local' ? '#fff' : 'var(--theme-muted)',
            }}
          >
            {isLocalMode ? 'Local' : 'Remote'} Workspaces
          </button>
        </div>

        {/* GitHub Repos tab */}
        {activeTab === 'github' && (<>
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-5 px-4 py-2.5 rounded-xl text-sm outline-none"
          style={{
            background: 'var(--theme-card)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
          }}
        />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          </div>
        )}

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#3f0f0f', color: '#f87171' }}>
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-center py-16" style={{ color: 'var(--theme-muted)' }}>
            {search ? 'No repositories match your search.' : 'No repositories found.'}
          </p>
        )}

        <div className="space-y-2">
          {filtered.map((repo) => (
            <button
              key={repo.id}
              onClick={() => handleSelectRepo(repo)}
              className="w-full text-left rounded-xl px-4 py-4 transition-colors"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-border)'
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm truncate" style={{ color: 'var(--theme-text)' }}>
                      {repo.full_name}
                    </span>
                    {repo.private && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                        style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
                      >
                        Private
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs truncate" style={{ color: 'var(--theme-muted)' }}>
                      {repo.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs" style={{ color: 'var(--theme-muted)' }}>
                  {repo.language && <span>{repo.language}</span>}
                  <span>★ {repo.stargazers_count}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        </>)}

        {/* Local Workspaces tab */}
        {activeTab === 'local' && (
          <>
            {/* New Project button */}
            {!showNewProject ? (
              <button
                onClick={() => setShowNewProject(true)}
                className="w-full mb-5 px-4 py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                style={{ background: 'var(--theme-card)', border: '2px dashed var(--theme-border)', color: 'var(--theme-muted)' }}
              >
                + New Project
              </button>
            ) : (
              <div className="mb-5 flex gap-2">
                <input
                  type="text"
                  placeholder="Project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  autoFocus
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-accent)', color: 'var(--theme-text)' }}
                />
                <button
                  onClick={handleCreateProject}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--theme-accent)', color: '#fff' }}
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowNewProject(false); setNewProjectName('') }}
                  className="px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: 'var(--theme-card)', color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}
                >
                  Cancel
                </button>
              </div>
            )}

            {localLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              </div>
            )}

            {!localLoading && localWorkspaces.length === 0 && (
              <p className="text-sm text-center py-16" style={{ color: 'var(--theme-muted)' }}>
                No local workspaces found. Create a new project above.
              </p>
            )}

            <div className="space-y-2">
              {localWorkspaces.map((ws) => (
                <button
                  key={ws.path}
                  onClick={() => navigate({ to: '/files', search: { path: ws.path } })}
                  className="w-full text-left rounded-xl px-4 py-4 transition-colors"
                  style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--theme-accent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--theme-border)' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">📁</span>
                      <span className="font-medium text-sm" style={{ color: 'var(--theme-text)' }}>{ws.name}</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>Local</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
