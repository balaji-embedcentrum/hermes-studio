/**
 * Branches tab — local + remote branch list with checkout, create, and fetch.
 *
 * Visual commit graph (@gitgraph/react) is intentionally deferred to a future
 * enhancement. List-based UX is enough for day-one parity with VS Code's
 * source control panel.
 */

import { useCallback, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle01Icon,
  GitBranchIcon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { useGit } from '../../hooks/use-git'
import { Button } from '../ui/button'

export function BranchesTab() {
  const {
    ready,
    branches,
    checkout,
    createBranch,
    fetchRemote,
  } = useGit()
  const [newBranchName, setNewBranchName] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) return
    try {
      await createBranch.mutateAsync({ name })
      setNewBranchName('')
      setShowCreate(false)
    } catch {
      // error surfaces via mutation.error
    }
  }, [createBranch, newBranchName])

  const handleCheckout = useCallback(
    async (branch: string) => {
      try {
        await checkout.mutateAsync({ branch })
      } catch {
        // error surfaces via mutation.error
      }
    },
    [checkout],
  )

  const handleCheckoutRemote = useCallback(
    async (remote: string) => {
      // "origin/feat/foo" → "feat/foo" (best-effort strip of the first segment)
      const local = remote.includes('/')
        ? remote.slice(remote.indexOf('/') + 1)
        : remote
      try {
        await checkout.mutateAsync({ branch: local, create: true })
      } catch {
        // error surfaces via mutation.error
      }
    },
    [checkout],
  )

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-muted)]">
        Open a workspace to see branches.
      </div>
    )
  }

  if (branches.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--theme-muted)]">
        Loading branches…
      </div>
    )
  }

  if (branches.isError) {
    return (
      <div className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
        <div className="font-medium">Git branches failed</div>
        <div className="mt-1 opacity-80">
          {branches.error instanceof Error
            ? branches.error.message
            : 'Unknown error'}
        </div>
      </div>
    )
  }

  const data = branches.data
  const current = data?.current ?? null
  const local = data?.local ?? []
  const remote = data?.remote ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setShowCreate((v) => !v)}
          title="New branch"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={16} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => fetchRemote.mutate()}
          disabled={fetchRemote.isPending}
          title="Fetch"
        >
          <HugeiconsIcon icon={RefreshIcon} size={16} />
        </Button>
        <div className="flex-1" />
        {current && (
          <span
            className="flex items-center gap-1 text-[10px]"
            style={{ color: 'var(--theme-muted)' }}
          >
            <HugeiconsIcon icon={GitBranchIcon} size={12} />
            {current}
          </span>
        )}
      </div>

      {showCreate && (
        <div
          className="border-b px-2 py-2"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder={`New branch from ${current ?? 'HEAD'}…`}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') setShowCreate(false)
            }}
            className="w-full rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:ring-1"
            style={{
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text)',
            }}
          />
          <div className="mt-1 flex gap-1">
            <button
              onClick={handleCreate}
              disabled={!newBranchName.trim() || createBranch.isPending}
              className="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: newBranchName.trim()
                  ? 'var(--theme-accent)'
                  : 'var(--theme-card)',
                color: newBranchName.trim() ? '#fff' : 'var(--theme-muted)',
              }}
            >
              {createBranch.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md px-2 py-1 text-xs"
              style={{ color: 'var(--theme-muted)' }}
            >
              Cancel
            </button>
          </div>
          {createBranch.isError && (
            <div className="mt-1 text-[11px] text-red-500">
              {createBranch.error instanceof Error
                ? createBranch.error.message
                : 'Create failed'}
            </div>
          )}
        </div>
      )}

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto">
        {local.length > 0 && (
          <BranchSection title="Local" count={local.length}>
            {local.map((b) => {
              const isCurrent = b.name === current
              return (
                <div
                  key={`local-${b.name}`}
                  className="group flex items-center gap-2 px-3 py-1 text-xs hover:bg-white/5"
                  style={{ color: 'var(--theme-text)' }}
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center">
                    {isCurrent ? (
                      <HugeiconsIcon
                        icon={CheckmarkCircle01Icon}
                        size={14}
                        style={{ color: 'var(--theme-accent)' }}
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={GitBranchIcon}
                        size={12}
                        style={{ color: 'var(--theme-muted)' }}
                      />
                    )}
                  </span>
                  <span className="flex-1 truncate font-mono">{b.name}</span>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    {b.sha}
                  </span>
                  {!isCurrent && (
                    <button
                      onClick={() => handleCheckout(b.name)}
                      disabled={checkout.isPending}
                      className="opacity-0 group-hover:opacity-100 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                      style={{ color: 'var(--theme-muted)' }}
                    >
                      Checkout
                    </button>
                  )}
                </div>
              )
            })}
          </BranchSection>
        )}

        {remote.length > 0 && (
          <BranchSection title="Remote" count={remote.length}>
            {remote.map((name) => (
              <div
                key={`remote-${name}`}
                className="group flex items-center gap-2 px-3 py-1 text-xs hover:bg-white/5"
                style={{ color: 'var(--theme-text)' }}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center">
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    size={12}
                    style={{ color: 'var(--theme-muted)' }}
                  />
                </span>
                <span className="flex-1 truncate font-mono">{name}</span>
                <button
                  onClick={() => handleCheckoutRemote(name)}
                  disabled={checkout.isPending}
                  className="opacity-0 group-hover:opacity-100 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  Check out
                </button>
              </div>
            ))}
          </BranchSection>
        )}

        {local.length === 0 && remote.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--theme-muted)]">
            No branches.
          </div>
        )}

        {checkout.isError && (
          <div className="m-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-500">
            {checkout.error instanceof Error
              ? checkout.error.message
              : 'Checkout failed'}
          </div>
        )}
      </div>
    </div>
  )
}

function BranchSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-1">
      <div
        className="sticky top-0 z-10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: 'var(--theme-sidebar)',
          color: 'var(--theme-muted)',
          borderBottom: '1px solid var(--theme-border)',
        }}
      >
        {title} <span className="opacity-60">({count})</span>
      </div>
      {children}
    </div>
  )
}
