/**
 * Mode-agnostic git hook. Picks transport from `workspace-store.localHermesUrl`:
 *
 *   localHermesUrl set  → browser calls `localGit*` in `lib/local-file-ops.ts`
 *                         which hits `${localHermesUrl}/ws/{repo}/git/*`
 *   localHermesUrl null → browser calls `/api/git`, Studio SSR proxies to the
 *                         cloud adapter (see `routes/api/git.ts`)
 *
 * Components consume this hook and never branch on transport mode themselves.
 */

import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { useWorkspaceStore } from '../stores/workspace-store'
import {
  localGitStatus,
  localGitLog,
  localGitBranches,
  localGitDiff,
  localGitShow,
  localGitStage,
  localGitUnstage,
  localGitDiscard,
  localGitCheckout,
  localGitCreateBranch,
  localGitFetch,
  localGitCommitWithOptions,
  localGitPull,
  localGitPush,
} from '../lib/local-file-ops'
import type {
  GitStatus,
  GitCommit,
  GitBranches,
  GitDiffResult,
  GitDiffOptions,
  GitShowResult,
  GitCommitInput,
  GitCheckoutInput,
  GitBranchInput,
} from '../types/git'

// ---------------------------------------------------------------------------
// Remote (SSR proxy) transport
// ---------------------------------------------------------------------------

async function remoteGet<T>(
  action: string,
  path: string,
  extraParams?: Record<string, string>,
): Promise<T> {
  const params = new URLSearchParams({ action, path, ...(extraParams ?? {}) })
  const res = await fetch(`/api/git?${params.toString()}`, {
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    status?: string
    message?: string
    error?: string
  } & Record<string, unknown>
  if (!res.ok || (data.status && data.status !== 'ok')) {
    throw new Error(
      data.message || data.error || `Git ${action} failed (${res.status})`,
    )
  }
  return data as unknown as T
}

async function remotePost<T>(
  action: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const params = new URLSearchParams({ action, path })
  const res = await fetch(`/api/git?${params.toString()}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    status?: string
    message?: string
    error?: string
  } & Record<string, unknown>
  if (!res.ok || (data.status && data.status !== 'ok')) {
    throw new Error(
      data.message || data.error || `Git ${action} failed (${res.status})`,
    )
  }
  return data as unknown as T
}

// ---------------------------------------------------------------------------
// Mode-aware call sites — components never see these directly
// ---------------------------------------------------------------------------

interface GitContext {
  /** Stable cache key — any string that changes when the workspace changes. */
  cacheKey: string
  /** When true, transport is local-direct; otherwise SSR proxy. */
  isLocal: boolean
  localUrl: string | null
  localRoot: string | null
  /** Remote-mode workspace path: `${userId}/${login}/${repo}` */
  remotePath: string
}

function useGitContext(): GitContext | null {
  const localUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const localRoot = useWorkspaceStore((s) => s.localWorkspaceRoot)
  const remotePath = useWorkspaceStore((s) => s.activeWorkspacePath)

  const isLocal = Boolean(localUrl && localRoot)
  const cacheKey = isLocal ? `local:${localRoot}` : `remote:${remotePath}`

  if (!isLocal && !remotePath) return null
  if (isLocal && !localRoot) return null

  return {
    cacheKey,
    isLocal,
    localUrl,
    localRoot,
    remotePath,
  }
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Derive the repo name (basename of the workspace root) for URL construction
 * on the local-direct SSE path. Remote mode uses the full `userId/login/repo`
 * workspace path and is handled by the SSR proxy.
 */
function extractRepoName(absPath: string): string {
  const segs = absPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return segs[segs.length - 1] || ''
}

export function useGit() {
  const ctx = useGitContext()
  const qc = useQueryClient()

  // Push-based status updates (phase G). For local mode we connect directly
  // to the adapter's SSE stream. Remote mode keeps the polling fallback —
  // proxying SSE through the Studio SSR server is a future enhancement.
  useEffect(() => {
    if (!ctx || !ctx.isLocal || !ctx.localUrl || !ctx.localRoot) return
    const repo = extractRepoName(ctx.localRoot)
    if (!repo) return
    const url = `${ctx.localUrl}/ws/${encodeURIComponent(repo)}/git/events`
    const es = new EventSource(url)
    const onChange = () => {
      qc.invalidateQueries({ queryKey: ['git', 'status', ctx.cacheKey] })
    }
    es.addEventListener('git.status.changed', onChange)
    // Also clean up on error — browsers will auto-reconnect; we don't need to
    // fight that, but close on unmount.
    return () => {
      es.removeEventListener('git.status.changed', onChange)
      es.close()
    }
  }, [ctx?.cacheKey, ctx?.isLocal, ctx?.localUrl, ctx?.localRoot, qc])

  const invalidate = (kind?: 'status' | 'log' | 'branches') => {
    if (!ctx) return
    const keys = kind
      ? [['git', kind, ctx.cacheKey]]
      : [
          ['git', 'status', ctx.cacheKey],
          ['git', 'log', ctx.cacheKey],
          ['git', 'branches', ctx.cacheKey],
        ]
    keys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
  }

  const enabled = ctx !== null

  const status = useQuery<GitStatus>({
    queryKey: ['git', 'status', ctx?.cacheKey],
    queryFn: async () => {
      if (!ctx) throw new Error('no workspace')
      return ctx.isLocal
        ? localGitStatus(ctx.localUrl!, ctx.localRoot!)
        : remoteGet<GitStatus>('status', ctx.remotePath)
    },
    enabled,
    // Local mode gets push updates via SSE (see useEffect above) — polling is
    // just a loose backup. Remote mode has no SSE yet, so it polls faster.
    refetchInterval: ctx?.isLocal ? 30_000 : 5_000,
  })

  const log = useQuery<GitCommit[]>({
    queryKey: ['git', 'log', ctx?.cacheKey],
    queryFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal) return localGitLog(ctx.localUrl!, ctx.localRoot!)
      const { commits } = await remoteGet<{ commits: GitCommit[] }>(
        'log',
        ctx.remotePath,
      )
      return commits
    },
    enabled,
  })

  const branches = useQuery<GitBranches>({
    queryKey: ['git', 'branches', ctx?.cacheKey],
    queryFn: async () => {
      if (!ctx) throw new Error('no workspace')
      return ctx.isLocal
        ? localGitBranches(ctx.localUrl!, ctx.localRoot!)
        : remoteGet<GitBranches>('branches', ctx.remotePath)
    },
    enabled,
  })

  const stage = useMutation({
    mutationFn: async (paths: string[]) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitStage(ctx.localUrl!, ctx.localRoot!, paths)
      await remotePost('stage', ctx.remotePath, { paths })
    },
    onSuccess: () => invalidate('status'),
  })

  const unstage = useMutation({
    mutationFn: async (paths: string[]) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitUnstage(ctx.localUrl!, ctx.localRoot!, paths)
      await remotePost('unstage', ctx.remotePath, { paths })
    },
    onSuccess: () => invalidate('status'),
  })

  const discard = useMutation({
    mutationFn: async (paths: string[]) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitDiscard(ctx.localUrl!, ctx.localRoot!, paths)
      await remotePost('discard', ctx.remotePath, { paths })
    },
    onSuccess: () => invalidate('status'),
  })

  const commit = useMutation({
    mutationFn: async (input: GitCommitInput) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitCommitWithOptions(ctx.localUrl!, ctx.localRoot!, input)
      await remotePost('commit', ctx.remotePath, {
        message: input.message,
        auto_stage: input.autoStage ?? true,
      })
    },
    onSuccess: () => invalidate(),
  })

  const push = useMutation({
    mutationFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal) return localGitPush(ctx.localUrl!, ctx.localRoot!)
      await remotePost('push', ctx.remotePath)
    },
    onSuccess: () => invalidate('status'),
  })

  const pull = useMutation({
    mutationFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal) return localGitPull(ctx.localUrl!, ctx.localRoot!)
      await remotePost('pull', ctx.remotePath)
    },
    onSuccess: () => invalidate(),
  })

  const checkout = useMutation({
    mutationFn: async (input: GitCheckoutInput) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitCheckout(ctx.localUrl!, ctx.localRoot!, input)
      await remotePost('checkout', ctx.remotePath, input)
    },
    onSuccess: () => invalidate(),
  })

  const createBranch = useMutation({
    mutationFn: async (input: GitBranchInput) => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitCreateBranch(ctx.localUrl!, ctx.localRoot!, input)
      await remotePost('branch', ctx.remotePath, input)
    },
    onSuccess: () => invalidate('branches'),
  })

  const fetchRemote = useMutation({
    mutationFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal) return localGitFetch(ctx.localUrl!, ctx.localRoot!)
      await remotePost('fetch', ctx.remotePath)
    },
    onSuccess: () => invalidate('branches'),
  })

  return {
    ready: ctx !== null,
    status,
    log,
    branches,
    stage,
    unstage,
    discard,
    commit,
    push,
    pull,
    checkout,
    createBranch,
    fetchRemote,
    invalidate,
  }
}

/**
 * Fetch a diff. Separate hook so callers can vary the options per-render
 * (e.g. when the user clicks a file in the Changes tab).
 */
export function useGitDiff(
  opts: GitDiffOptions,
  queryOpts?: Partial<UseQueryOptions<GitDiffResult>>,
) {
  const ctx = useGitContext()
  const key = JSON.stringify(opts)
  return useQuery<GitDiffResult>({
    queryKey: ['git', 'diff', ctx?.cacheKey, key],
    queryFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (ctx.isLocal)
        return localGitDiff(ctx.localUrl!, ctx.localRoot!, opts)
      const extra: Record<string, string> = {}
      if (opts.path) extra.diff_path = opts.path
      if (opts.staged) extra.staged = 'true'
      if (opts.ref) extra.ref = opts.ref
      return remoteGet<GitDiffResult>('diff', ctx.remotePath, extra)
    },
    enabled: ctx !== null,
    ...queryOpts,
  })
}

/**
 * Fetch commit metadata + diff for a specific SHA.
 */
export function useGitShow(
  sha: string | null,
  queryOpts?: Partial<UseQueryOptions<GitShowResult>>,
) {
  const ctx = useGitContext()
  return useQuery<GitShowResult>({
    queryKey: ['git', 'show', ctx?.cacheKey, sha],
    queryFn: async () => {
      if (!ctx) throw new Error('no workspace')
      if (!sha) throw new Error('no sha')
      return ctx.isLocal
        ? localGitShow(ctx.localUrl!, ctx.localRoot!, sha)
        : remoteGet<GitShowResult>('show', ctx.remotePath, { sha })
    },
    enabled: ctx !== null && !!sha,
    ...queryOpts,
  })
}

// Explicit re-export to keep the long list of named imports working when
// consumers import mutation option types from this module.
export type { UseMutationOptions }
