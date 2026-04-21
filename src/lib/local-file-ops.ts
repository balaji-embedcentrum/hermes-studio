/**
 * Local agent file operations — browser talks directly to localhost Hermes.
 * Used when localHermesUrl is set in workspace store.
 * This completely bypasses /api/files (server-side proxy) and goes direct.
 */

type FileEntry = {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modifiedAt?: string
  children?: Array<FileEntry>
}

/**
 * Extract repo name from an absolute workspace path.
 * E.g. "/Users/me/projects/owner/repo" → "repo"
 * E.g. "/Users/me/projects/repo" → "repo"
 */
function extractRepoName(absPath: string): string {
  const segments = absPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] || ''
}

/**
 * Get the relative path of a file within the workspace.
 * E.g. absPath="/Users/.../repo/src/main.req", workspaceRoot="/Users/.../repo" → "src/main.req"
 */
function getRelativePath(filePath: string, workspaceRoot: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.startsWith(normalizedRoot + '/')) {
    return normalized.slice(normalizedRoot.length + 1)
  }
  if (normalized === normalizedRoot) return ''
  // Might be a deeper path — try extracting from the repo name match
  return ''
}

/**
 * List files in a directory via local Hermes agent.
 * @param agentUrl - local Hermes URL (e.g. http://localhost:8642)
 * @param workspaceRoot - project root (e.g. /Users/.../projects/owner/MyRepo)
 * @param dirPath - directory to list (same as workspaceRoot for root, or a subfolder path)
 */
export async function localListFiles(
  agentUrl: string,
  workspaceRoot: string,
  dirPath?: string,
): Promise<Array<FileEntry>> {
  const repo = extractRepoName(workspaceRoot)
  if (!repo) return []
  const relPath = dirPath ? getRelativePath(dirPath, workspaceRoot) : ''

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/tree?path=${encodeURIComponent(relPath)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) return []

  const data = (await res.json()) as {
    entries?: Array<{ name: string; path: string; type: string }>
  }
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    path: `${workspaceRoot}/${e.path}`,
    type: e.type === 'dir' ? 'folder' as const : 'file' as const,
  }))
}

/**
 * Read file content via local Hermes agent.
 */
export async function localReadFile(
  agentUrl: string,
  rootPath: string,
  filePath: string,
): Promise<{ content: string; type: string }> {
  const repo = extractRepoName(rootPath)
  const relPath = getRelativePath(filePath, rootPath)
  if (!repo || !relPath) throw new Error('Invalid file path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(relPath)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(d.message || 'Failed to read file')
  }

  const data = (await res.json()) as { content?: string }
  return { content: data.content ?? '', type: 'text' }
}

/**
 * Write file content via local Hermes agent.
 */
export async function localWriteFile(
  agentUrl: string,
  rootPath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  const relPath = getRelativePath(filePath, rootPath)
  if (!repo || !relPath) throw new Error('Invalid file path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/file`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, content }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(d.message || 'Failed to write file')
  }
}

/**
 * Delete file via local Hermes agent.
 */
export async function localDeleteFile(
  agentUrl: string,
  rootPath: string,
  filePath: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  const relPath = getRelativePath(filePath, rootPath)
  if (!repo || !relPath) throw new Error('Invalid file path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(relPath)}`,
    {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(d.message || 'Failed to delete file')
  }
}

/**
 * Create directory via local Hermes agent (writes a .gitkeep file).
 */
export async function localMkdir(
  agentUrl: string,
  rootPath: string,
  dirPath: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  const relPath = getRelativePath(dirPath, rootPath)
  if (!repo) throw new Error('Invalid path')
  const gitkeepPath = relPath ? `${relPath}/.gitkeep` : '.gitkeep'

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/file`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: gitkeepPath, content: '' }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) throw new Error('Failed to create directory')
}

/**
 * Git pull via local Hermes agent.
 */
export async function localGitPull(
  agentUrl: string,
  rootPath: string,
): Promise<string> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/git/pull`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    },
  )
  const data = (await res.json()) as { output?: string; message?: string }
  if (!res.ok) throw new Error(data.message || 'Git pull failed')
  return data.output ?? ''
}

/**
 * Git commit via local Hermes agent.
 */
export async function localGitCommit(
  agentUrl: string,
  rootPath: string,
  message: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/git/commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) throw new Error('Git commit failed')
}

/**
 * Git push via local Hermes agent.
 */
export async function localGitPush(
  agentUrl: string,
  rootPath: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')

  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/git/push`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!res.ok) throw new Error('Git push failed')
}

// ---------------------------------------------------------------------------
// Git read endpoints (require hermes-adapter PR #10)
// ---------------------------------------------------------------------------

import type {
  GitStatus,
  GitCommit,
  GitBranches,
  GitShowResult,
  GitDiffResult,
  GitDiffOptions,
  GitCommitInput,
  GitCheckoutInput,
  GitBranchInput,
} from '../types/git'

async function gitFetch<T>(
  agentUrl: string,
  repo: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repo)}/git/${path}`,
    { signal: AbortSignal.timeout(30_000), ...init },
  )
  const data = (await res.json().catch(() => ({}))) as {
    status?: string
    message?: string
  } & Record<string, unknown>
  if (!res.ok || data.status !== 'ok') {
    throw new Error(data.message ?? `Git ${path} failed (${res.status})`)
  }
  return data as unknown as T
}

export async function localGitStatus(
  agentUrl: string,
  rootPath: string,
): Promise<GitStatus> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  const { changed, ahead, behind } = await gitFetch<{
    changed: GitStatus['changed']
    ahead: number
    behind: number
  }>(agentUrl, repo, 'status')
  return { changed, ahead, behind }
}

export async function localGitLog(
  agentUrl: string,
  rootPath: string,
  limit = 50,
): Promise<GitCommit[]> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  const { commits } = await gitFetch<{ commits: GitCommit[] }>(
    agentUrl,
    repo,
    `log?limit=${limit}`,
  )
  return commits
}

export async function localGitBranches(
  agentUrl: string,
  rootPath: string,
): Promise<GitBranches> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  return gitFetch<GitBranches>(agentUrl, repo, 'branches')
}

export async function localGitDiff(
  agentUrl: string,
  rootPath: string,
  opts: GitDiffOptions = {},
): Promise<GitDiffResult> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  const params = new URLSearchParams()
  if (opts.path) params.set('path', opts.path)
  if (opts.staged) params.set('staged', 'true')
  if (opts.ref) params.set('ref', opts.ref)
  const qs = params.toString()
  return gitFetch<GitDiffResult>(agentUrl, repo, `diff${qs ? `?${qs}` : ''}`)
}

export async function localGitShow(
  agentUrl: string,
  rootPath: string,
  sha: string,
): Promise<GitShowResult> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  return gitFetch<GitShowResult>(
    agentUrl,
    repo,
    `show/${encodeURIComponent(sha)}`,
  )
}

// ---------------------------------------------------------------------------
// Git write endpoints (require hermes-adapter PR #11)
// ---------------------------------------------------------------------------

export async function localGitStage(
  agentUrl: string,
  rootPath: string,
  paths: string[],
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function localGitUnstage(
  agentUrl: string,
  rootPath: string,
  paths: string[],
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'unstage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function localGitDiscard(
  agentUrl: string,
  rootPath: string,
  paths: string[],
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export async function localGitCheckout(
  agentUrl: string,
  rootPath: string,
  input: GitCheckoutInput,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function localGitCreateBranch(
  agentUrl: string,
  rootPath: string,
  input: GitBranchInput,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function localGitFetch(
  agentUrl: string,
  rootPath: string,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'fetch', { method: 'POST' })
}

/**
 * Commit variant that supports selective staging via `auto_stage: false`.
 * `localGitCommit` (above) preserves the legacy stage-everything behavior.
 */
export async function localGitCommitWithOptions(
  agentUrl: string,
  rootPath: string,
  input: GitCommitInput,
): Promise<void> {
  const repo = extractRepoName(rootPath)
  if (!repo) throw new Error('Invalid path')
  await gitFetch(agentUrl, repo, 'commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input.message,
      auto_stage: input.autoStage ?? true,
    }),
  })
}
