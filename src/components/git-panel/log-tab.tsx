/**
 * Log tab — commit history list. Click a commit to open its patch in the
 * main editor area (reuses GitDiffView with { ref: <sha> }).
 */

import { useGit } from '../../hooks/use-git'
import type { GitDiffSelection } from './diff-view'

interface LogTabProps {
  onOpenDiff?: (selection: GitDiffSelection) => void
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function LogTab({ onOpenDiff }: LogTabProps) {
  const { ready, log } = useGit()

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-muted)]">
        Open a workspace to see git history.
      </div>
    )
  }

  if (log.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--theme-muted)]">
        Loading commits…
      </div>
    )
  }

  if (log.isError) {
    return (
      <div className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
        <div className="font-medium">Git log failed</div>
        <div className="mt-1 opacity-80">
          {log.error instanceof Error ? log.error.message : 'Unknown error'}
        </div>
      </div>
    )
  }

  const commits = log.data ?? []
  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-muted)]">
        No commits yet.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {commits.map((c) => {
        const clickable = !!onOpenDiff
        return (
          <div
            key={c.hash}
            role={clickable ? 'button' : undefined}
            onClick={
              clickable
                ? () =>
                    onOpenDiff!({
                      path: c.shortHash,
                      source: `${c.author} · ${formatDate(c.date)}`,
                      options: { ref: c.hash },
                    })
                : undefined
            }
            className={`flex flex-col gap-0.5 border-b px-3 py-2 text-xs ${clickable ? 'cursor-pointer hover:bg-white/5' : ''}`}
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="truncate font-medium"
                style={{ color: 'var(--theme-text)' }}
                title={c.message}
              >
                {c.message}
              </span>
            </div>
            <div
              className="flex items-center gap-2 text-[10px]"
              style={{ color: 'var(--theme-muted)' }}
            >
              <span className="font-mono">{c.shortHash}</span>
              <span>·</span>
              <span className="truncate">{c.author}</span>
              <span>·</span>
              <span className="shrink-0">{formatDate(c.date)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
