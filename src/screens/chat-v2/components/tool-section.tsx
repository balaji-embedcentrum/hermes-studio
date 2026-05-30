/**
 * Compact CLI-styled tool call card for chat-v2.
 *
 * Inspired by the legacy TuiActivityCard (447 lines, tightly coupled
 * to the legacy chat store) — this is a focused ~150-line re-do that
 * just consumes chat-v2's ToolPart shape directly. One row per tool
 * call, status dot on the left, expandable args/result below.
 *
 *   ● Read message-item.tsx            ▸
 *     ⎿ 1240 lines
 *   ○ exec pnpm build                  ▸
 *     ⎿ running…
 */

import { useState } from 'react'
import type { ToolPart } from '../runtime/use-sylang-chat'
import { cn } from '@/lib/utils'

type Props = {
  tool: ToolPart
}

function statusGlyph(phase: ToolPart['phase']): {
  icon: string
  className: string
} {
  switch (phase) {
    case 'complete':
      return { icon: '●', className: 'text-emerald-600' }
    case 'error':
      return { icon: '✗', className: 'text-red-600' }
    case 'running':
      return { icon: '○', className: 'text-amber-500 animate-pulse' }
    case 'start':
    default:
      return { icon: '○', className: 'text-primary-400' }
  }
}

function summarize(tool: ToolPart): string {
  // Prefer the explicit preview the agent emitted; fall back to a one-line
  // summary of result or args.
  if (tool.preview && tool.preview.trim()) {
    return firstLine(tool.preview)
  }
  if (tool.result !== undefined && tool.result !== null) {
    const r = tool.result
    if (typeof r === 'string') return firstLine(r) || '(empty result)'
    return firstLine(JSON.stringify(r))
  }
  if (tool.args && typeof tool.args === 'object') {
    const entries = Object.entries(tool.args as Record<string, unknown>)
    if (entries.length === 0) return ''
    const [k, v] = entries[0]
    const vs = typeof v === 'string' ? v : JSON.stringify(v)
    return firstLine(`${k}=${vs}`)
  }
  return ''
}

function firstLine(text: string): string {
  const t = text.split('\n')[0].trim()
  return t.length > 80 ? `${t.slice(0, 77)}…` : t
}

function hasDetails(tool: ToolPart): boolean {
  if (tool.args && typeof tool.args === 'object') {
    if (Object.keys(tool.args as Record<string, unknown>).length > 0) return true
  }
  if (tool.result !== undefined && tool.result !== null && tool.result !== '') {
    return true
  }
  return false
}

export function ToolSection({ tool }: Props) {
  const [open, setOpen] = useState(false)
  const { icon, className: iconClass } = statusGlyph(tool.phase)
  const summary = summarize(tool)
  const expandable = hasDetails(tool)

  return (
    <div className="my-1 rounded border border-primary-200/70 bg-primary-50/40 text-xs dark:border-primary-700/70 dark:bg-primary-900/40">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          'group flex w-full items-start gap-2 px-2 py-1.5 text-left',
          expandable && 'hover:bg-primary-100/60 dark:hover:bg-primary-800/60',
          !expandable && 'cursor-default',
        )}
      >
        <span className={cn('mt-0.5 flex-none font-mono text-sm', iconClass)}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono font-medium text-primary-900 dark:text-primary-100">
            {tool.name}
          </span>
          {summary && (
            <span className="ml-2 text-primary-500 dark:text-primary-400">{summary}</span>
          )}
        </span>
        {expandable && (
          <span
            aria-hidden="true"
            className="flex-none text-[10px] text-primary-400 group-hover:text-primary-600 dark:text-primary-500 dark:group-hover:text-primary-300"
          >
            {open ? '▾' : '▸'}
          </span>
        )}
      </button>

      {open && expandable && (
        <div className="space-y-1.5 border-t border-primary-200/60 px-2 py-2 dark:border-primary-700/60">
          {Boolean(
            tool.args &&
              typeof tool.args === 'object' &&
              Object.keys(tool.args as Record<string, unknown>).length > 0,
          ) && (
            <DetailBlock label="Args" body={JSON.stringify(tool.args, null, 2)} />
          )}
          {Boolean(
            tool.preview &&
              tool.preview.trim() &&
              tool.preview !== summarize(tool),
          ) && (
            <DetailBlock
              label="Preview"
              body={tool.preview ?? ''}
              mono={false}
            />
          )}
          {tool.result !== undefined && tool.result !== null && tool.result !== '' && (
            <DetailBlock
              label={tool.phase === 'error' ? 'Error' : 'Result'}
              body={
                typeof tool.result === 'string'
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)
              }
              danger={tool.phase === 'error'}
            />
          )}
        </div>
      )}
    </div>
  )
}

function DetailBlock({
  label,
  body,
  mono = true,
  danger = false,
}: {
  label: string
  body: string
  mono?: boolean
  danger?: boolean
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-0.5 text-[9px] font-medium uppercase tracking-wider',
          danger
            ? 'text-red-600 dark:text-red-300'
            : 'text-primary-500 dark:text-primary-400',
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          'max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-1.5 text-[11px] leading-snug ring-1 ring-primary-200/50',
          'dark:bg-primary-950/60 dark:ring-primary-700/50',
          mono ? 'font-mono' : 'font-sans',
          danger
            ? 'text-red-700 dark:text-red-200'
            : 'text-primary-700 dark:text-primary-200',
        )}
      >
        {body}
      </pre>
    </div>
  )
}
