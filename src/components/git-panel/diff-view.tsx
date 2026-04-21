/**
 * Diff view — renders a unified diff for a single file/change in a readonly
 * CodeMirror editor. Line-level decorations color additions (green) and
 * deletions (red); hunk headers get a muted tint.
 *
 * Source of diff text is `useGitDiff({ path, staged, ref })` from the
 * mode-aware hook. The parent (FilesRoute) lifts a `GitDiffSelection` into
 * the main editor area when the user clicks a file in the Changes / Log tabs.
 */

import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useGitDiff } from '../../hooks/use-git'
import type { GitDiffOptions } from '../../types/git'

export interface GitDiffSelection {
  path: string
  /** Label shown in the header — e.g. "Staged", "Unstaged", "abc1234" */
  source: string
  options: GitDiffOptions
}

const addLine = Decoration.line({
  attributes: { style: 'background-color: rgba(16,185,129,0.10);' },
})
const delLine = Decoration.line({
  attributes: { style: 'background-color: rgba(239,68,68,0.10);' },
})
const hunkLine = Decoration.line({
  attributes: {
    style:
      'background-color: rgba(139,92,246,0.10); color: var(--theme-muted);',
  },
})

function decorateDiff(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (let pos = 0; pos < view.state.doc.length; ) {
    const line = view.state.doc.lineAt(pos)
    const head = line.text[0]
    if (head === '+' && !line.text.startsWith('+++')) {
      builder.add(line.from, line.from, addLine)
    } else if (head === '-' && !line.text.startsWith('---')) {
      builder.add(line.from, line.from, delLine)
    } else if (head === '@' && line.text.startsWith('@@')) {
      builder.add(line.from, line.from, hunkLine)
    }
    pos = line.to + 1
  }
  return builder.finish()
}

const diffHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorateDiff(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = decorateDiff(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

interface Props {
  selection: GitDiffSelection
  onClose: () => void
}

export function GitDiffView({ selection, onClose }: Props) {
  const diff = useGitDiff(selection.options)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const text = diff.data?.diff ?? ''
    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        oneDark,
        EditorView.editable.of(false),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
        }),
        diffHighlight,
      ],
    })
    viewRef.current?.destroy()
    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [diff.data?.diff])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex items-center gap-3 border-b px-4 py-1.5 text-xs shrink-0"
        style={{
          background: 'var(--theme-sidebar)',
          borderColor: 'var(--theme-border)',
        }}
      >
        <span
          className="font-mono font-medium"
          style={{ color: 'var(--theme-text)' }}
        >
          {selection.path}
        </span>
        <span style={{ color: 'var(--theme-muted)' }}>
          {selection.source}
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded px-2 py-0.5 text-[11px] hover:bg-white/5"
          style={{ color: 'var(--theme-muted)' }}
          title="Close diff"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {diff.isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--theme-muted)]">
            Loading diff…
          </div>
        ) : diff.isError ? (
          <div className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            {diff.error instanceof Error
              ? diff.error.message
              : 'Failed to load diff'}
          </div>
        ) : !diff.data?.diff ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--theme-muted)]">
            No differences.
          </div>
        ) : (
          <div ref={containerRef} className="h-full" />
        )}
      </div>
    </div>
  )
}
