/**
 * Git SSR proxy — remote-mode bridge between the browser and the cloud
 * hermes-adapter. Local mode (localHermesUrl set in the workspace store)
 * never hits this route; the browser calls the local adapter directly via
 * `local-file-ops.ts`.
 *
 * Query shape (both GET and POST):
 *   path=<userId>/<githubLogin>/<repo>  — identifies the workspace
 *   action=<op>                          — status|log|branches|diff|show|
 *                                          stage|unstage|discard|commit|
 *                                          push|pull|checkout|branch|fetch
 *
 * Per-action extras:
 *   diff:   diff_path=<rel>  staged=true  ref=<sha>
 *   show:   sha=<ref>
 *   log:    limit=<n>
 *
 * POST actions take a JSON body that is forwarded verbatim to the adapter.
 * The adapter already validates shape; the proxy is a thin pass-through
 * plus auth + agent-config lookup, matching the pattern in `api/files.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getAgentConfig } from '../../server/gateway-capabilities'
import { getAuthUser } from '../../server/supabase-auth'
import { validateSession } from '../../server/agent-sessions'

const HERMES_API_URL = (process.env.HERMES_API_URL || '')
  .trim()
  .replace(/\/$/, '')

type GitAction =
  | 'status'
  | 'log'
  | 'branches'
  | 'diff'
  | 'show'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'push'
  | 'pull'
  | 'checkout'
  | 'branch'
  | 'fetch'
  | 'pr'

const READ_ACTIONS = new Set<GitAction>([
  'status',
  'log',
  'branches',
  'diff',
  'show',
])

const WRITE_ACTIONS = new Set<GitAction>([
  'stage',
  'unstage',
  'discard',
  'commit',
  'push',
  'pull',
  'checkout',
  'branch',
  'fetch',
  'pr',
])

function parseWorkspacePath(relPath: string) {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3) return null
  return {
    userId: parts[0],
    repoName: parts[2],
  }
}

/**
 * Build the adapter URL path (relative, no host) from the inbound request.
 * Example: action=show sha=abc → /show/abc ; action=diff (with params) → /diff?path=...
 */
function buildAdapterPath(
  action: GitAction,
  repo: string,
  params: URLSearchParams,
): string {
  const base = `/ws/${encodeURIComponent(repo)}/git/${action}`

  if (action === 'show') {
    const sha = params.get('sha')
    if (!sha) throw new Error('sha required for action=show')
    return `/ws/${encodeURIComponent(repo)}/git/show/${encodeURIComponent(sha)}`
  }

  if (action === 'diff') {
    const q = new URLSearchParams()
    const diffPath = params.get('diff_path')
    const staged = params.get('staged')
    const ref = params.get('ref')
    if (diffPath) q.set('path', diffPath)
    if (staged) q.set('staged', staged)
    if (ref) q.set('ref', ref)
    const qs = q.toString()
    return qs ? `${base}?${qs}` : base
  }

  if (action === 'log') {
    const limit = params.get('limit')
    return limit ? `${base}?limit=${encodeURIComponent(limit)}` : base
  }

  return base
}

export const Route = createFileRoute('/api/git')({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request, 'GET'),
      POST: async ({ request }) => handle(request, 'POST'),
    },
  },
})

async function handle(request: Request, method: 'GET' | 'POST') {
  if (!(await isAuthenticated(request))) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const action = (url.searchParams.get('action') || '') as GitAction
  const inputPath = url.searchParams.get('path') || ''

  if (method === 'GET' && !READ_ACTIONS.has(action)) {
    return json({ error: `Unknown read action: ${action}` }, { status: 400 })
  }
  if (method === 'POST' && !WRITE_ACTIONS.has(action)) {
    return json({ error: `Unknown write action: ${action}` }, { status: 400 })
  }

  const parsed = parseWorkspacePath(inputPath)
  if (!parsed) {
    return json(
      { error: 'path must be {userId}/{githubLogin}/{repo}' },
      { status: 400 },
    )
  }

  const authUser = await getAuthUser(request).catch(() => null)
  if (authUser?.userId && parsed.userId !== authUser.userId) {
    return json(
      { error: 'Access denied — workspace belongs to another user' },
      { status: 403 },
    )
  }

  // Remote mode writes require a live agent session (matches api/files.ts policy)
  if (authUser?.userId && method === 'POST') {
    const sess = await validateSession(authUser.userId)
    if (!sess.valid) {
      return json({ error: sess.error, code: sess.code }, { status: 403 })
    }
  }

  const agentConfig = authUser?.userId
    ? await getAgentConfig(authUser.userId).catch(() => null)
    : null
  const remoteAgentUrl = agentConfig?.url || HERMES_API_URL
  if (!remoteAgentUrl) {
    return json({ error: 'No agent configured' }, { status: 503 })
  }

  let adapterPath: string
  try {
    adapterPath = buildAdapterPath(action, parsed.repoName, url.searchParams)
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Bad request' },
      { status: 400 },
    )
  }

  const headers: Record<string, string> = {}
  if (agentConfig?.apiKey)
    headers['Authorization'] = `Bearer ${agentConfig.apiKey}`

  let body: string | undefined
  if (method === 'POST') {
    const raw = await request.text()
    if (raw) {
      headers['Content-Type'] = 'application/json'
      body = raw
    }
  }

  const r = await fetch(`${remoteAgentUrl}${adapterPath}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  })

  const text = await r.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { status: 'error', message: text }
  }

  return json(payload, { status: r.status })
}
