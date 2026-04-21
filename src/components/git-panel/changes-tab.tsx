/**
 * Changes tab — file status list + inline commit form.
 *
 * Reads from `useGit().status` (auto-refetched every 10s by the hook), and
 * writes via stage/unstage/discard/commit/push/pull mutations. Staged vs
 * unstaged vs untracked buckets are derived from porcelain X (index) + Y
 * (worktree) columns returned by the adapter.
 */

import { useCallback, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  PlusSignIcon,
  RefreshIcon,
  UploadSquare01Icon,
} from '@hugeicons/core-free-icons'
import { useGit } from '../../hooks/use-git'
import type { GitFileStatus } from '../../types/git'
import type { GitDiffSelection } from './diff-view'
import { Button } from '../ui/button'

function statusLabel(code: string): { label: string; color: string } {
  switch (code) {
    case 'M':
      return { label: 'M', color: 'var(--theme-accent)' }
    case 'A':
      return { label: 'A', color: '#10b981' }
    case 'D':
      return { label: 'D', color: '#ef4444' }
    case 'R':
      return { label: 'R', color: '#3b82f6' }
    case '?':
      return { label: 'U', color: 'var(--theme-muted)' }
    case 'U':
      return { label: '!', color: '#ef4444' }
    default:
      return { label: code.trim() || '·', color: 'var(--theme-muted)' }
  }
}

function isStaged(f: GitFileStatus): boolean {
  return f.index !== ' ' && f.index !== '?'
}

function isUnstagedTracked(f: GitFileStatus): boolean {
  return f.worktree !== ' ' && f.worktree !== '?'
}

function isUntracked(f: GitFileStatus): boolean {
  return f.index === '?' && f.worktree === '?'
}

interface ChangesTabProps {
  onOpenDiff?: (selection: GitDiffSelection) => void
}

export function ChangesTab({ onOpenDiff }: ChangesTabProps) {
  const {
    ready,
    status,
    stage,
    unstage,
    discard,
    commit,
    push,
    pull,
  } = useGit()
  const [message, setMessage] = useState('')

  const files = status.data?.changed ?? []
  const ahead = status.data?.ahead ?? 0
  const behind = status.data?.behind ?? 0

  const { staged, unstaged, untracked } = useMemo(() => {
    const staged: GitFileStatus[] = []
    const unstaged: GitFileStatus[] = []
    const untracked: GitFileStatus[] = []
    for (const f of files) {
      if (isUntracked(f)) untracked.push(f)
      else {
        if (isStaged(f)) staged.push(f)
        if (isUnstagedTracked(f)) unstaged.push(f)
      }
    }
    return { staged, unstaged, untracked }
  }, [files])

  const handleCommit = useCallback(async () => {
    const msg = message.trim()
    if (!msg || staged.length === 0) return
    try {
      await commit.mutateAsync({ message: msg, autoStage: false })
      setMessage('')
    } catch {
      // error surfaces via mutation.error; toast system TBD
    }
  }, [commit, message, staged.length])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-muted)]">
        Open a workspace to see git status.
      </div>
    )
  }

  if (status.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--theme-muted)]">
        Loading git status…
      </div>
    )
  }

  if (status.isError) {
    return (
      <div className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
        <div className="font-medium">Git status failed</div>
        <div className="mt-1 opacity-80">
          {status.error instanceof Error
            ? status.error.message
            : 'Unknown error'}
        </div>
      </div>
    )
  }

  const nothingToCommit =
    staged.length === 0 && unstaged.length === 0 && untracked.length === 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => status.refetch()}
          title="Refresh status"
        >
          <HugeiconsIcon icon={RefreshIcon} size={16} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => pull.mutate()}
          disabled={pull.isPending}
          title={behind > 0 ? `Pull (${behind} behind)` : 'Pull'}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} />
          {behind > 0 && (
            <span className="ml-0.5 text-[10px]">{behind}</span>
          )}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => push.mutate()}
          disabled={push.isPending}
          title={ahead > 0 ? `Push (${ahead} ahead)` : 'Push'}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={16} />
          {ahead > 0 && <span className="ml-0.5 text-[10px]">{ahead}</span>}
        </Button>
      </div>

      {/* Commit form */}
      <div
        className="border-b px-2 py-2"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            staged.length > 0
              ? `Commit message (${staged.length} staged)…`
              : 'Stage files to commit…'
          }
          rows={2}
          className="w-full resize-none rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:ring-1"
          style={{
            borderColor: 'var(--theme-border)',
            color: 'var(--theme-text)',
          }}
        />
        <div className="mt-1 flex gap-1">
          <button
            onClick={handleCommit}
            disabled={
              staged.length === 0 ||
              !message.trim() ||
              commit.isPending
            }
            className="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background:
                staged.length > 0 && message.trim()
                  ? 'var(--theme-accent)'
                  : 'var(--theme-card)',
              color:
                staged.length > 0 && message.trim()
                  ? '#fff'
                  : 'var(--theme-muted)',
            }}
          >
            {commit.isPending ? 'Committing…' : 'Commit'}
          </button>
        </div>
        {commit.isError && (
          <div className="mt-1 text-[11px] text-red-500">
            {commit.error instanceof Error
              ? commit.error.message
              : 'Commit failed'}
          </div>
        )}
      </div>

      {/* File sections */}
      <div className="flex-1 overflow-y-auto">
        {nothingToCommit ? (
          <div className="px-3 py-8 text-center text-xs text-[var(--theme-muted)]">
            No local changes.
          </div>
        ) : (
          <>
            {staged.length > 0 && (
              <Section
                title="Staged Changes"
                count={staged.length}
                files={staged}
                rowKind="staged"
                onAction={(paths) => unstage.mutate(paths)}
                actionIcon={PlusSignIcon}
                actionTitle="Unstage"
                actionPending={unstage.isPending}
                fileColumn="index"
                onOpenDiff={
                  onOpenDiff
                    ? (path) =>
                        onOpenDiff({
                          path,
                          source: 'Staged',
                          options: { path, staged: true },
                        })
                    : undefined
                }
              />
            )}
            {unstaged.length > 0 && (
              <Section
                title="Changes"
                count={unstaged.length}
                files={unstaged}
                rowKind="unstaged"
                onAction={(paths) => stage.mutate(paths)}
                actionIcon={UploadSquare01Icon}
                actionTitle="Stage"
                actionPending={stage.isPending}
                secondaryAction={{
                  icon: Delete01Icon,
                  title: 'Discard',
                  onAction: (paths) => {
                    if (
                      !window.confirm(
                        `Discard changes to ${paths.length === 1 ? paths[0] : `${paths.length} files`}? This cannot be undone.`,
                      )
                    )
                      return
                    discard.mutate(paths)
                  },
                  pending: discard.isPending,
                }}
                fileColumn="worktree"
                onOpenDiff={
                  onOpenDiff
                    ? (path) =>
                        onOpenDiff({
                          path,
                          source: 'Unstaged',
                          options: { path },
                        })
                    : undefined
                }
              />
            )}
            {untracked.length > 0 && (
              <Section
                title="Untracked"
                count={untracked.length}
                files={untracked}
                rowKind="untracked"
                onAction={(paths) => stage.mutate(paths)}
                actionIcon={UploadSquare01Icon}
                actionTitle="Stage"
                actionPending={stage.isPending}
                fileColumn="worktree"
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

type RowKind = 'staged' | 'unstaged' | 'untracked'

interface SectionProps {
  title: string
  count: number
  files: GitFileStatus[]
  rowKind: RowKind
  onAction: (paths: string[]) => void
  actionIcon: typeof PlusSignIcon
  actionTitle: string
  actionPending: boolean
  secondaryAction?: {
    icon: typeof PlusSignIcon
    title: string
    onAction: (paths: string[]) => void
    pending: boolean
  }
  /** Which porcelain column to display the status letter from. */
  fileColumn: 'index' | 'worktree'
  /** When provided, clicking a row fires the diff-open callback. */
  onOpenDiff?: (path: string) => void
}

function Section({
  title,
  count,
  files,
  onAction,
  actionIcon,
  actionTitle,
  actionPending,
  secondaryAction,
  fileColumn,
  onOpenDiff,
}: SectionProps) {
  return (
    <div className="mb-1">
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-3 py-1 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: 'var(--theme-sidebar)',
          color: 'var(--theme-muted)',
          borderBottom: '1px solid var(--theme-border)',
        }}
      >
        <span>
          {title}{' '}
          <span className="opacity-60">({count})</span>
        </span>
        <button
          onClick={() => onAction(files.map((f) => f.path))}
          disabled={actionPending}
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-white/5"
          title={`${actionTitle} all`}
        >
          {actionTitle} all
        </button>
      </div>
      {files.map((f) => {
        const code = f[fileColumn]
        const s = statusLabel(code)
        const clickable = !!onOpenDiff
        return (
          <div
            key={`${title}-${f.path}`}
            role={clickable ? 'button' : undefined}
            onClick={clickable ? () => onOpenDiff!(f.path) : undefined}
            className={`group flex items-center gap-2 px-3 py-1 text-xs hover:bg-white/5 ${clickable ? 'cursor-pointer' : ''}`}
            style={{ color: 'var(--theme-text)' }}
          >
            <span
              className="inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold"
              style={{ color: s.color }}
            >
              {s.label}
            </span>
            <span
              className="flex-1 truncate font-mono"
              title={f.path}
            >
              {f.path}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              {secondaryAction && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    secondaryAction.onAction([f.path])
                  }}
                  disabled={secondaryAction.pending}
                  title={secondaryAction.title}
                >
                  <HugeiconsIcon icon={secondaryAction.icon} size={14} />
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  onAction([f.path])
                }}
                disabled={actionPending}
                title={actionTitle}
              >
                <HugeiconsIcon icon={actionIcon} size={14} />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
