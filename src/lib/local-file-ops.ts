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
 * E.g. "/Users/balaji/sylang-projects/owner/repo" → "repo"
 * E.g. "/Users/balaji/sylang-projects/repo" → "repo"
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
 * @param workspaceRoot - project root (e.g. /Users/.../sylang-projects/owner/AutoInverter)
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
