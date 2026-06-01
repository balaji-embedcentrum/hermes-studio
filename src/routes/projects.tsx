import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { brand } from '@/brand'
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
  /** Supabase workspaces.id — present in remote mode, absent in local mode. */
  id?: string
}

type PlaygroundProject = {
  id: string
  repo_full: string
  repo_url: string | null
  name: string | null
  description: string | null
  tags: string[] | null
}

type TabId = 'playground' | 'github' | 'local' | 'public'

/** Parse a GitHub URL or `owner/repo` into `owner/repo`, or null. */
function parsePublicRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '')
  if (!s) return null
  const m =
    s.match(/github\.com[/:]([^/\s]+\/[^/\s]+)/i) ??
    s.match(/^([\w.-]+\/[\w.-]+)$/)
  return m ? m[1] : null
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
  const [activeTab, setActiveTab] = useState<TabId>('playground')
  const [hasAgent, setHasAgent] = useState(true) // optimistic, checked on load
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalWorkspace[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [playground, setPlayground] = useState<PlaygroundProject[]>([])
  const [playgroundLoading, setPlaygroundLoading] = useState(false)
  const [publicRepoInput, setPublicRepoInput] = useState('')
  const [publicRepoError, setPublicRepoError] = useState<string | null>(null)

  // Guard: redirect to /agents if no agent is selected (remote mode only).
  // BYO single-tenant agents (user_vps, user_tunnel) don't have a session
  // lifecycle — a registered personal agent is sufficient.
  useEffect(() => {
    if (isLocalMode) return
    ;(async () => {
      try {
        const agentsRes = await fetch('/api/agents/list').then(r => r.json())
        const personal = (agentsRes.agents ?? []).find((a: { owner_user_id?: string | null }) => !!a.owner_user_id)
        if (personal) return

        const sess = await fetch('/api/agent-sessions/status').then(r => r.json())
        if (!sess.session) {
          setHasAgent(false)
          navigate({ to: '/agents' })
        }
      } catch {
        /* swallow — letting the page render is safer than redirect-looping on a network blip */
      }
    })()
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
        .then((data: { workspaces?: Array<{ id: string; repo_full: string; workspace_path: string; last_accessed: string | null }> }) => {
          const ws = (data.workspaces ?? []).map(w => ({
            id: w.id,
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

  // Load the curated playground projects (global list) the first time the
  // tab is viewed.
  useEffect(() => {
    if (activeTab !== 'playground' || playground.length > 0) return
    setPlaygroundLoading(true)
    fetch('/api/playground/list')
      .then(r => r.json())
      .then((data: { projects?: PlaygroundProject[] }) => {
        setPlayground(data.projects ?? [])
      })
      .catch(() => setPlayground([]))
      .finally(() => setPlaygroundLoading(false))
  }, [activeTab, playground.length])

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) return
    setNewProjectError(null)
    setCreatingProject(true)
    try {
      if (localHermesUrl) {
        // Local mode: create empty workspace via local agent
        const res = await fetch(
          `${localHermesUrl}/ws/${encodeURIComponent(name)}/init`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empty: true }),
          },
        )
        const data = (await res.json().catch(() => ({}))) as {
          status?: string
          path?: string
          message?: string
        }
        if (!res.ok || data.status !== 'ok' || !data.path) {
          setNewProjectError(
            data.message ?? `Local agent could not create project (${res.status})`,
          )
          return
        }
        setShowNewProject(false)
        setNewProjectName('')
        navigate({ to: '/files', search: { path: data.path } })
      } else {
        // Remote mode: create via server API. Server now verifies the
        // agent actually created the directory before returning ok.
        const res = await fetch('/api/workspaces/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          path?: string
          error?: string
          agent_reported_path?: string | null
        }
        if (!res.ok || !data.ok || !data.path) {
          setNewProjectError(
            data.error ?? `Project creation failed (${res.status})`,
          )
          return
        }
        setShowNewProject(false)
        setNewProjectName('')
        navigate({ to: '/files', search: { path: data.path } })
      }
    } catch (err) {
      setNewProjectError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setCreatingProject(false)
    }
  }

  // Permanently delete a cloned repo — removes the directory on the agent's
  // filesystem (and, in remote mode, the Supabase workspace record).
  const handleDeleteWorkspace = async (ws: LocalWorkspace) => {
    setDeleteError(null)
    setDeleting(ws.path)
    try {
      if (localHermesUrl) {
        // Local mode: delete directly via the local agent. `path=.` resolves
        // to the repo root, so the agent rmtree's the whole directory.
        const repoName = ws.name.split('/').pop() ?? ws.name
        const res = await fetch(
          `${localHermesUrl}/ws/${encodeURIComponent(repoName)}/file?path=.`,
          { method: 'DELETE', signal: AbortSignal.timeout(30_000) },
        )
        if (!res.ok && res.status !== 404) throw new Error(`Agent returned ${res.status}`)
      } else {
        // Remote mode: delete via server API (verifies ownership, drops record).
        if (!ws.id) throw new Error('Missing workspace id')
        const res = await fetch('/api/workspaces/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: ws.id }),
        })
        const data = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) throw new Error(data.error ?? 'Delete failed')
      }
      setLocalWorkspaces(list => list.filter(w => w.path !== ws.path))
      setConfirmDelete(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete repo')
    } finally {
      setDeleting(null)
    }
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

  // Clone any public repo by `owner/repo` — reuses the exact same flow as
  // a GitHub-repo card (open → clone). Playground projects and the
  // "Clone Public Repo" tab both go through here.
  const handleCloneRepoFull = (repoFull: string, description?: string | null) => {
    void handleSelectRepo({
      id: -1,
      full_name: repoFull,
      name: repoFull.split('/').pop() ?? repoFull,
      description: description ?? null,
      private: false,
      updated_at: '',
      language: null,
      stargazers_count: 0,
    })
  }

  const handleClonePublicRepo = () => {
    const repoFull = parsePublicRepo(publicRepoInput)
    if (!repoFull) {
      setPublicRepoError('Enter a public repo as a GitHub URL or owner/repo.')
      return
    }
    setPublicRepoError(null)
    handleCloneRepoFull(repoFull)
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
          <img src={brand.logo} alt={brand.appTitle} className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-lg" style={{ color: 'var(--theme-text)' }}>
            {brand.appTitle}
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
          Start from a playground project, your GitHub repos, an existing clone, or any public repo
        </p>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-5 rounded-xl p-1" style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}>
          {([
            ['playground', 'Playground Projects'],
            ['public', 'Clone Public Repo'],
            ['github', 'Your GitHub Repos'],
            ['local', 'Your Cloned Repos'],
          ] as Array<[TabId, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex-1 text-xs sm:text-sm py-2 px-1 rounded-lg font-medium transition-colors"
              style={{
                background: activeTab === id ? 'var(--theme-accent)' : 'transparent',
                color: activeTab === id ? '#fff' : 'var(--theme-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Playground Projects tab */}
        {activeTab === 'playground' && (
          <>
            <input
              type="text"
              placeholder="Search playground projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full mb-5 px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
            />

            {playgroundLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              </div>
            )}

            {!playgroundLoading && playground.length === 0 && (
              <p className="text-sm text-center py-16" style={{ color: 'var(--theme-muted)' }}>
                No playground projects yet.
              </p>
            )}

            <div className="space-y-2">
              {playground
                .filter((p) => {
                  const q = search.toLowerCase()
                  return (
                    (p.name ?? '').toLowerCase().includes(q) ||
                    p.repo_full.toLowerCase().includes(q) ||
                    (p.description ?? '').toLowerCase().includes(q)
                  )
                })
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleCloneRepoFull(p.repo_full, p.description)}
                    className="w-full text-left rounded-xl px-4 py-4 transition-colors"
                    style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--theme-accent)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--theme-border)' }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm truncate" style={{ color: 'var(--theme-text)' }}>
                            {p.name || p.repo_full}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                            style={{ background: 'var(--theme-accent)', color: '#fff' }}
                          >
                            Playground
                          </span>
                        </div>
                        {p.description && (
                          <p className="text-xs truncate" style={{ color: 'var(--theme-muted)' }}>
                            {p.description}
                          </p>
                        )}
                      </div>
                      {p.tags && p.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          </>
        )}

        {/* Clone Public Repo tab */}
        {activeTab === 'public' && (
          <div className="rounded-xl p-5" style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}>
            <p className="text-sm mb-3" style={{ color: 'var(--theme-text)' }}>
              Clone any public GitHub repository into your own private workspace.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://github.com/owner/repo  ·  or  owner/repo"
                value={publicRepoInput}
                onChange={(e) => { setPublicRepoInput(e.target.value); setPublicRepoError(null) }}
                onKeyDown={(e) => e.key === 'Enter' && handleClonePublicRepo()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
              />
              <button
                onClick={handleClonePublicRepo}
                className="px-4 py-2.5 rounded-xl text-sm font-medium shrink-0"
                style={{ background: 'var(--theme-accent)', color: '#fff' }}
              >
                Clone
              </button>
            </div>
            {publicRepoError && (
              <p className="text-xs mt-2" style={{ color: '#f87171' }}>{publicRepoError}</p>
            )}
            <p className="text-xs mt-3" style={{ color: 'var(--theme-muted)' }}>
              Only public repos. Your changes stay in your private copy — they don't affect the original.
            </p>
          </div>
        )}

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
              <div className="mb-5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Project name..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                    autoFocus
                    disabled={creatingProject}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none disabled:opacity-60"
                    style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-accent)', color: 'var(--theme-text)' }}
                  />
                  <button
                    onClick={handleCreateProject}
                    disabled={creatingProject}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60"
                    style={{ background: 'var(--theme-accent)', color: '#fff' }}
                  >
                    {creatingProject ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                      setNewProjectError(null)
                    }}
                    disabled={creatingProject}
                    className="px-3 py-2.5 rounded-xl text-sm disabled:opacity-60"
                    style={{ background: 'var(--theme-card)', color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}
                  >
                    Cancel
                  </button>
                </div>
                {!localHermesUrl && !newProjectError && (
                  <p
                    className="mt-2 text-xs"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    A private GitHub repo will be created at{' '}
                    <span className="font-mono">
                      github.com/{githubLogin ?? 'you'}/
                      {newProjectName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') ||
                        '...'}
                    </span>{' '}
                    and cloned to your workspace.
                  </p>
                )}
                {newProjectError && (
                  <div
                    className="mt-2 px-3 py-2 rounded-lg text-xs"
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#dc2626',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    {newProjectError}
                  </div>
                )}
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

            {deleteError && (
              <div className="rounded-xl px-4 py-3 mb-3 text-sm" style={{ background: '#3f0f0f', color: '#f87171' }}>
                {deleteError}
              </div>
            )}

            <div className="space-y-2">
              {localWorkspaces.map((ws) => {
                const isConfirming = confirmDelete === ws.path
                const isDeleting = deleting === ws.path
                return (
                  <div
                    key={ws.path}
                    className="w-full flex items-center rounded-xl transition-colors"
                    style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--theme-accent)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--theme-border)' }}
                  >
                    <button
                      onClick={() => navigate({ to: '/files', search: { path: ws.path } })}
                      className="flex-1 min-w-0 text-left px-4 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">📁</span>
                        <span className="font-medium text-sm truncate" style={{ color: 'var(--theme-text)' }}>{ws.name}</span>
                      </div>
                    </button>
                    <div className="shrink-0 flex items-center gap-1.5 pr-3">
                      {isConfirming ? (
                        <>
                          <span className="text-xs mr-1" style={{ color: 'var(--theme-muted)' }}>Delete repo?</span>
                          <button
                            onClick={() => handleDeleteWorkspace(ws)}
                            disabled={isDeleting}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                            style={{ background: '#dc2626', color: '#fff', opacity: isDeleting ? 0.6 : 1 }}
                          >
                            {isDeleting ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            disabled={isDeleting}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setDeleteError(null); setConfirmDelete(ws.path) }}
                          title="Delete cloned repo"
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          style={{ color: '#f87171' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
