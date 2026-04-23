import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  isAuthenticated,
  requireLocalOrAuth,
} from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import { getAgentConfig } from '../../server/gateway-capabilities'
import { getAuthUser } from '../../server/supabase-auth'
import { validateSession } from '../../server/agent-sessions'
const execFileAsync = promisify(execFile)

// In remote mode this is a virtual path prefix only — no local FS access.
// In local mode it's the actual directory Hermes uses.
const WORKSPACE_ROOT = (
  process.env.HERMES_WORKSPACE_DIR ||
  path.join(os.homedir(), '.hermes')
).trim()

const HERMES_API_URL = (process.env.HERMES_API_URL || '').trim().replace(/\/$/, '')

// Parse {userId}/{githubLogin}/{repo}/{relInRepo}
// Returns repo as "{githubLogin}/{repo}" for user-scoped agent lookup
function parseWorkspacePath(relPath: string) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3) return null
  return {
    userId: parts[0],
    githubLogin: parts[1],
    // Per-agent symlink isolation: the agent's HERMES_WORKSPACE_DIR
    // already points at /opt/workspaces/active-<agent>, which resolves
    // to the current user's directory. So the agent's /ws/<repo>/...
    // API expects just the repo name — no `<login>/<repo>` prefix.
    // Pre-isolation deployments used `login/repo`; that path now 404s.
    repo: parts[2],
    repoName: parts[2],
    relInRepo: parts.slice(3).join('/'),
  }
}

type FileEntry = {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modifiedAt?: string
  children?: Array<FileEntry>
}

function ensureWorkspacePath(input: string) {
  const raw = input.trim()
  if (!raw) return WORKSPACE_ROOT
  // Always anchor resolution to WORKSPACE_ROOT. Absolute paths supplied by
  // the caller are treated as relative to WORKSPACE_ROOT by stripping the
  // leading slash — we never honor an attacker-supplied /etc/passwd.
  const normalized = raw.replace(/^\/+/, '')
  const resolved = path.resolve(WORKSPACE_ROOT, normalized)
  // Final containment check after symlink-agnostic resolve. A normalized
  // path that still escapes the root (e.g. via relative traversal) is rejected.
  const rootWithSep = WORKSPACE_ROOT.endsWith(path.sep)
    ? WORKSPACE_ROOT
    : WORKSPACE_ROOT + path.sep
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('Path is outside workspace')
  }
  return resolved
}

function toRelative(resolvedPath: string) {
  // For absolute paths outside WORKSPACE_ROOT (local agent mode), return as-is
  if (!resolvedPath.startsWith(WORKSPACE_ROOT)) return resolvedPath
  const relative = path.relative(WORKSPACE_ROOT, resolvedPath)
  return relative || ''
}

function sortEntries(entries: Array<FileEntry>) {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function normalizePathForGlob(input: string) {
  return input.replace(/\\/g, '/')
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasGlob(input: string) {
  return input.includes('*')
}

function parseGlobPattern(input: string) {
  const normalized = normalizePathForGlob(input.trim())
  const lastSlashIndex = normalized.lastIndexOf('/')
  const directoryPath =
    lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : ''
  const filePattern =
    lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized

  const regexSource = `^${escapeRegex(filePattern).replace(/\\\*/g, '.*')}$`

  return {
    directoryPath,
    regex: new RegExp(regexSource),
  }
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'dist',
  '.DS_Store',
])

const MAX_DIRECTORY_DEPTH = 3
const MAX_DIRECTORY_ENTRIES = 20_000

type ReadDirectoryOptions = {
  maxDepth: number
  maxEntries: number | null
  countedEntries: { value: number }
}

function parseMaxDepth(input: string | null): number | null {
  if (!input) return null
  const parsed = Number(input)
  if (!Number.isFinite(parsed)) return null
  return Math.min(MAX_DIRECTORY_DEPTH, Math.max(0, Math.floor(parsed)))
}

function parseMaxEntries(input: string | null): number | null {
  if (!input) return null
  const parsed = Number(input)
  if (!Number.isFinite(parsed)) return null
  return Math.min(MAX_DIRECTORY_ENTRIES, Math.max(1, Math.floor(parsed)))
}

async function readDirectory(
  dirPath: string,
  depth: number,
  options: ReadDirectoryOptions,
): Promise<Array<FileEntry>> {
  if (depth > options.maxDepth) return []
  if (
    options.maxEntries !== null &&
    options.countedEntries.value >= options.maxEntries
  ) {
    return []
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const mapped: Array<FileEntry> = []

  for (const entry of entries) {
    if (
      options.maxEntries !== null &&
      options.countedEntries.value >= options.maxEntries
    ) {
      break
    }

    if (IGNORED_DIRS.has(entry.name)) continue
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = toRelative(fullPath)
    try {
      const stats = await fs.stat(fullPath)
      if (entry.isDirectory()) {
        const children = await readDirectory(fullPath, depth + 1, options)
        mapped.push({
          name: entry.name,
          path: relativePath,
          type: 'folder',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          children,
        })
      } else {
        mapped.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        })
      }
      options.countedEntries.value += 1
    } catch {
      // Skip broken symlinks or inaccessible entries
      continue
    }
  }

  return sortEntries(mapped)
}

async function readGlobDirectory(globPath: string) {
  const { directoryPath, regex } = parseGlobPattern(globPath)
  const resolvedDirectory = ensureWorkspacePath(directoryPath)
  const entries = await fs.readdir(resolvedDirectory, { withFileTypes: true })
  const mapped: Array<FileEntry> = []

  for (const entry of entries) {
    if (!regex.test(entry.name)) continue
    const fullPath = path.join(resolvedDirectory, entry.name)
    const stats = await fs.stat(fullPath)
    mapped.push({
      name: entry.name,
      path: toRelative(fullPath),
      type: entry.isDirectory() ? 'folder' : 'file',
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    })
  }

  return {
    root: toRelative(resolvedDirectory),
    entries: sortEntries(mapped),
  }
}

function getMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function isImageFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)
}

async function remoteWalkTree(
  hermesUrl: string,
  repo: string,
  relPath: string,
  prefix: string,
  extFilter: string | null,
  depth: number,
): Promise<Array<FileEntry>> {
  if (depth > 4) return []
  const r = await fetch(`${hermesUrl}/ws/${encodeURIComponent(repo)}/tree?path=${encodeURIComponent(relPath)}`)
  if (!r.ok) return []
  const d = await r.json() as { entries?: Array<{ name: string; path: string; type: string }> }
  const result: Array<FileEntry> = []
  const subDirPromises: Array<Promise<Array<FileEntry>>> = []
  for (const e of d.entries ?? []) {
    if (e.type === 'dir') {
      subDirPromises.push(remoteWalkTree(hermesUrl, repo, e.path, prefix, extFilter, depth + 1))
    } else if (!extFilter || e.name.endsWith(extFilter)) {
      result.push({ name: e.name, path: `${prefix}/${e.path}`, type: 'file' })
    }
  }
  const sub = await Promise.all(subDirPromises)
  return [...result, ...sub.flat()]
}

export const Route = createFileRoute('/api/files')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAuthenticated(request))) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const action = url.searchParams.get('action') || 'list'
          const inputPath = url.searchParams.get('path') || ''
          const maxDepthParam = parseMaxDepth(url.searchParams.get('maxDepth'))
          const maxEntriesParam = parseMaxEntries(
            url.searchParams.get('maxEntries'),
          )

          // ── Remote agent mode: proxy through agent's /ws/* API ─────────
          // Resolve the agent URL per-user from Supabase (or fall back to env var)
          const authUser = await getAuthUser(request).catch(() => null)
          const agentConfig = authUser?.userId ? await getAgentConfig(authUser.userId).catch(() => null) : null
          const remoteAgentUrl = agentConfig?.url || HERMES_API_URL
          const parsed = parseWorkspacePath(inputPath)
          const isAbsoluteLocalPath = path.isAbsolute(inputPath)
          console.info(`[files GET] action=${action} path="${inputPath}" userId=${authUser?.userId ?? 'NONE'} agentUrl=${remoteAgentUrl || 'NONE'} parsed=${!!parsed} absLocal=${isAbsoluteLocalPath}`)
          // Use remote proxy if path looks like a VPS workspace path (userId/login/repo)
          // and we have an agent URL to proxy through
          if (parsed && remoteAgentUrl && !isAbsoluteLocalPath) {
            // Enforce active session for remote agent file ops
            if (authUser?.userId) {
              const sessCheck = await validateSession(authUser.userId)
              if (!sessCheck.valid) {
                return json({ error: sessCheck.error, code: sessCheck.code }, { status: 403 })
              }
            }
            const { userId: pathUserId, repo, relInRepo } = parsed
            // Privacy: verify the workspace path belongs to the requesting user
            if (authUser?.userId && pathUserId !== authUser.userId) {
              return json({ error: 'Access denied — workspace belongs to another user' }, { status: 403 })
            }
            const prefix = inputPath.replace(/\\/g, '/').split('/').slice(0, 3).join('/')
            const agentHeaders: Record<string, string> = {}
            if (agentConfig?.apiKey) agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`

            if (action === 'git-pull') {
              const r = await fetch(`${remoteAgentUrl}/ws/${encodeURIComponent(repo)}/git/pull`, { method: 'POST', headers: agentHeaders })
              const d = await r.json() as { output?: string; message?: string }
              return r.ok
                ? json({ ok: true, output: d.output ?? '' })
                : json({ ok: false, error: d.message ?? r.statusText }, { status: r.status })
            }

            if (action === 'read') {
              if (!relInRepo) return json({ error: 'path required' }, { status: 400 })
              const r = await fetch(`${remoteAgentUrl}/ws/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(relInRepo)}`, { headers: agentHeaders })
              if (!r.ok) {
                const d = await r.json().catch(() => ({})) as { message?: string }
                return json({ error: `Agent: ${d.message ?? r.statusText}` }, { status: r.status })
              }
              const d = await r.json() as { content?: string }
              return json({ type: 'text', path: inputPath, content: d.content ?? '' })
            }

            // action === 'list' (default)
            if (relInRepo.includes('*')) {
              const extMatch = relInRepo.match(/\*(\.\w+)$/)
              const extFilter = extMatch ? extMatch[1] : null
              const allFiles = await remoteWalkTree(remoteAgentUrl, repo, '', prefix, extFilter, 0)
              return json({ root: inputPath, base: WORKSPACE_ROOT, entries: allFiles })
            }
            const treeUrl = `${remoteAgentUrl}/ws/${encodeURIComponent(repo)}/tree?path=${encodeURIComponent(relInRepo)}`
            console.info(`[files GET] proxying to agent: ${treeUrl}`)
            const r = await fetch(treeUrl, { headers: agentHeaders })
            console.info(`[files GET] agent responded: ${r.status}`)
            if (!r.ok) {
              const d = await r.json().catch(() => ({})) as { message?: string }
              console.error(`[files GET] agent error: ${d.message ?? r.statusText}`)
              return json({ error: `Agent: ${d.message ?? r.statusText}` }, { status: r.status })
            }
            const d = await r.json() as { entries?: Array<{ name: string; path: string; type: string }> }
            console.info(`[files GET] agent returned ${d.entries?.length ?? 0} entries`)
            const entries: Array<FileEntry> = (d.entries ?? []).map(e => ({
              name: e.name,
              path: `${prefix}/${e.path}`,
              type: e.type === 'dir' ? 'folder' : 'file',
            }))
            return json({ root: inputPath, base: WORKSPACE_ROOT, entries })
          }

          // ── Local mode ─────────────────────────────────────────────────
          if (action === 'list' && hasGlob(inputPath)) {
            const globListing = await readGlobDirectory(inputPath)
            return json({
              root: globListing.root,
              base: WORKSPACE_ROOT,
              entries: globListing.entries,
            })
          }

          if (action === 'git-pull') {
            const resolvedDir = ensureWorkspacePath(inputPath)
            try {
              const { stdout, stderr } = await execFileAsync('git', ['pull', '--rebase'], {
                cwd: resolvedDir,
                timeout: 30_000,
              })
              return json({ ok: true, output: (stdout + stderr).trim() })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              return json({ ok: false, error: msg }, { status: 500 })
            }
          }

          // ── Local filesystem (absolute paths from local agent mode) ────
          const resolvedPath = ensureWorkspacePath(inputPath)

          if (action === 'read') {
            const [buffer, stats] = await Promise.all([
              fs.readFile(resolvedPath),
              fs.stat(resolvedPath),
            ])
            if (isImageFile(resolvedPath)) {
              const mime = getMimeType(resolvedPath)
              return json({
                type: 'image',
                path: toRelative(resolvedPath),
                content: `data:${mime};base64,${buffer.toString('base64')}`,
                modifiedAt: stats.mtime.toISOString(),
              })
            }
            return json({
              type: 'text',
              path: toRelative(resolvedPath),
              content: buffer.toString('utf8'),
              modifiedAt: stats.mtime.toISOString(),
            })
          }

          if (action === 'download') {
            const buffer = await fs.readFile(resolvedPath)
            return new Response(buffer, {
              headers: {
                'Content-Type': getMimeType(resolvedPath),
                'Content-Disposition': `attachment; filename="${path.basename(
                  resolvedPath,
                )}"`,
              },
            })
          }

          const tree = await readDirectory(resolvedPath, 0, {
            maxDepth: maxDepthParam ?? MAX_DIRECTORY_DEPTH,
            maxEntries: maxEntriesParam,
            countedEntries: { value: 0 },
          })
          return json({
            root: toRelative(resolvedPath),
            base: WORKSPACE_ROOT,
            entries: tree,
          })
        } catch (err) {
          return json({ error: safeErrorMessage(err) }, { status: 500 })
        }
      },
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const ip = getClientIp(request)
        if (!rateLimit(`files:${ip}`, 30, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const contentType = request.headers.get('content-type') || ''
          if (!contentType.includes('multipart/form-data')) {
            const csrfCheck = requireJsonContentType(request)
            if (csrfCheck) return csrfCheck
          }

          // Multipart upload — only works when files are on the local filesystem
          if (contentType.includes('multipart/form-data')) {
            const form = await request.formData()
            const action = String(form.get('action') || 'upload')
            if (action !== 'upload') {
              return json({ error: 'Invalid upload request' }, { status: 400 })
            }
            const file = form.get('file')
            const targetPath = String(form.get('path') || '')
            if (!(file instanceof File)) {
              return json({ error: 'Missing file' }, { status: 400 })
            }
            const resolvedTarget = ensureWorkspacePath(targetPath)
            const isDir = (await fs.stat(resolvedTarget)).isDirectory()
            const destination = isDir
              ? path.join(resolvedTarget, file.name)
              : resolvedTarget
            await fs.mkdir(path.dirname(destination), { recursive: true })
            const buffer = Buffer.from(await file.arrayBuffer())
            await fs.writeFile(destination, buffer)
            return json({ ok: true, path: toRelative(destination) })
          }

          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const action = typeof body.action === 'string' ? body.action : 'write'

          // ── Remote mode: all writes proxy through agent's /ws/* ──────────
          const postAuthUser = await getAuthUser(request).catch(() => null)
          const postAgentConfig = postAuthUser?.userId ? await getAgentConfig(postAuthUser.userId).catch(() => null) : null
          const postAgentUrl = postAgentConfig?.url || HERMES_API_URL
          const postFilePath = String(body.path || body.from || '')
          const postParsed = parseWorkspacePath(postFilePath)
          const isPostAbsLocal = path.isAbsolute(postFilePath)
          if (postParsed && postAgentUrl && !isPostAbsLocal) {
            const { userId: postPathUserId, repo, relInRepo } = postParsed
            // Privacy: verify the workspace path belongs to the requesting user
            if (postAuthUser?.userId && postPathUserId !== postAuthUser.userId) {
              return json({ error: 'Access denied — workspace belongs to another user' }, { status: 403 })
            }
            console.info(`[files POST] action=${action} path="${postFilePath}" agent=${postAgentUrl}`)
            const agentHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
            if (postAgentConfig?.apiKey) agentHeaders['Authorization'] = `Bearer ${postAgentConfig.apiKey}`

            if (action === 'write') {
              if (!relInRepo) return json({ error: 'path required' }, { status: 400 })
              const writeContent = typeof body.content === 'string' ? body.content : ''
              const r = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(repo)}/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: relInRepo, content: writeContent }),
              })
              if (!r.ok) {
                const d = await r.json().catch(() => ({})) as { message?: string }
                return json({ error: `Agent: ${d.message ?? r.statusText}` }, { status: r.status })
              }
              return json({ ok: true, path: postFilePath })
            }

            if (action === 'git-commit') {
              const r = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(repo)}/git/commit`, {
                method: 'POST',
                headers: agentHeaders,
                body: JSON.stringify({ message: body.message || 'Update via Hermes Studio' }),
              })
              const d = await r.json() as { sha?: string; message?: string }
              return r.ok ? json({ ok: true, sha: d.sha }) : json({ error: d.message }, { status: r.status })
            }

            if (action === 'git-push') {
              const r = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(repo)}/git/push`, { method: 'POST', headers: agentHeaders })
              const d = await r.json() as { output?: string; message?: string }
              return r.ok ? json({ ok: true, output: d.output }) : json({ error: d.message }, { status: r.status })
            }

            // mkdir — create directory on agent by writing a .gitkeep inside it
            if (action === 'mkdir') {
              const dirPath = String(body.path || '')
              if (!dirPath) return json({ error: 'path required' }, { status: 400 })
              const dirParsed = parseWorkspacePath(dirPath)
              if (dirParsed) {
                // Has workspace prefix — write .gitkeep in the subfolder
                const gitkeepPath = dirParsed.relInRepo ? `${dirParsed.relInRepo}/.gitkeep` : '.gitkeep'
                const r = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(dirParsed.repo)}/file`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: gitkeepPath, content: '' }),
                })
                if (r.ok) return json({ ok: true, path: dirPath })
                return json({ error: 'Failed to create folder on agent' }, { status: 500 })
              }
              // No workspace prefix — might be a new project name
              const initR = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(dirPath)}/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ empty: true }),
              })
              if (initR.ok) return json({ ok: true, path: dirPath })
              return json({ error: 'Failed to create project on agent' }, { status: 500 })
            }

            // rename — read source, write to dest, delete source
            if (action === 'rename') {
              const fromPath = String(body.from || '')
              const toPath = String(body.to || '')
              const fromParsed = parseWorkspacePath(fromPath)
              const toParsed = parseWorkspacePath(toPath)
              if (!fromParsed || !toParsed) return json({ error: 'Invalid paths' }, { status: 400 })

              // Read source file
              const readR = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(fromParsed.repo)}/file?path=${encodeURIComponent(fromParsed.relInRepo)}`, { headers: agentHeaders })
              if (!readR.ok) return json({ error: 'Source file not found' }, { status: 404 })
              const { content } = await readR.json() as { content: string }

              // Write to destination
              const writeR = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(toParsed.repo)}/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: toParsed.relInRepo, content }),
              })
              if (!writeR.ok) return json({ error: 'Failed to write destination' }, { status: 500 })

              // Delete source
              await fetch(`${postAgentUrl}/ws/${encodeURIComponent(fromParsed.repo)}/file?path=${encodeURIComponent(fromParsed.relInRepo)}`, {
                method: 'DELETE',
              })

              return json({ ok: true, path: toPath })
            }

            // delete — via agent DELETE /ws/{repo}/file?path=
            if (action === 'delete') {
              const delParsed = parseWorkspacePath(postFilePath)
              if (!delParsed) return json({ error: 'Invalid path' }, { status: 400 })
              const r = await fetch(`${postAgentUrl}/ws/${encodeURIComponent(delParsed.repo)}/file?path=${encodeURIComponent(delParsed.relInRepo)}`, {
                method: 'DELETE',
              })
              if (r.ok) return json({ ok: true })
              const d = await r.json().catch(() => ({})) as { message?: string }
              return json({ error: d.message ?? 'Delete failed' }, { status: r.status })
            }

            return json({ error: `Action '${action}' not supported in remote mode` }, { status: 503 })
          }

          // ── Local mode ─────────────────────────────────────────────────
          if (action === 'mkdir') {
            const dirPath = ensureWorkspacePath(String(body.path || ''))
            await fs.mkdir(dirPath, { recursive: true })
            return json({ ok: true, path: toRelative(dirPath) })
          }

          if (action === 'rename') {
            const fromPath = ensureWorkspacePath(String(body.from || ''))
            const toPath = ensureWorkspacePath(String(body.to || ''))
            await fs.mkdir(path.dirname(toPath), { recursive: true })
            await fs.rename(fromPath, toPath)
            return json({ ok: true, path: toRelative(toPath) })
          }

          if (action === 'delete') {
            if (!(await requireLocalOrAuth(request))) {
              return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
            }
            const targetPath = ensureWorkspacePath(String(body.path || ''))
            try {
              await execFileAsync('trash', [targetPath])
            } catch {
              await fs.rm(targetPath, { recursive: true, force: true })
            }
            return json({ ok: true })
          }

          // ── Local filesystem (absolute paths from local agent mode) ────
          const filePath = ensureWorkspacePath(String(body.path || ''))
          const content = typeof body.content === 'string' ? body.content : ''
          await fs.mkdir(path.dirname(filePath), { recursive: true })
          await fs.writeFile(filePath, content, 'utf8')
          return json({ ok: true, path: toRelative(filePath) })
        } catch (err) {
          return json({ error: safeErrorMessage(err) }, { status: 500 })
        }
      },
    },
  },
})
