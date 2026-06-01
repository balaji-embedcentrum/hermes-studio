/**
 * CoverageView — renders the workspace coverage report inline in the
 * Sylang editor. Pure React table (no iframe, no global CSS, no fixed
 * positioning), so it composes cleanly with the host's layout.
 *
 * Data flow:
 *   GET /api/sylang/coverage?workspace=…
 *     → TraceabilityMatrixBuilder.extractSymbolAnalyses
 *     → 5-state classification (isolated / orphan / sink / connected / broken)
 *
 * Same source-of-truth (`ServerSymbolManager.allDocuments`) as the
 * diagram, spec-dash, and FMEA routes, so this view stays in sync with
 * edits made through any other surface.
 */
import { useEffect, useState } from 'react'

type CoverageStatus = 'isolated' | 'orphan' | 'sink' | 'connected' | 'broken'

interface RelationshipDetail {
  sourceId: string
  targetId: string
  relationshipType: string
  isValid: boolean
}

interface CoverageSymbol {
  name: string
  kind: string
  fileName: string
  /** Full workspace path — used by onNavigate to open the file. */
  fileUri: string
  outgoing: number
  incoming: number
  broken: number
  status: CoverageStatus
  outgoingRelationships: RelationshipDetail[]
  incomingRelationships: RelationshipDetail[]
}

interface CoverageSummary {
  total: number
  isolated: number
  orphan: number
  sink: number
  connected: number
  broken: number
  brokenRefCount: number
}

// Card chrome — colour + glyph per status. Order here drives the
// 5-card row across the top.
const STATUS_CONFIG: Record<
  CoverageStatus,
  { bg: string; color: string; label: string; icon: string; sublabel: string }
> = {
  isolated: { bg: 'rgba(107,114,128,0.2)', color: '#9ca3af', label: 'ISOLATED', icon: '🧊', sublabel: 'No relationships' },
  orphan: { bg: 'rgba(245,158,11,0.2)', color: '#f59e0b', label: 'ORPHAN', icon: '🟡', sublabel: 'No incoming' },
  sink: { bg: 'rgba(249,115,22,0.2)', color: '#f97316', label: 'SINK', icon: '🔥', sublabel: 'No outgoing' },
  connected: { bg: 'rgba(16,185,129,0.2)', color: '#10b981', label: 'CONNECTED', icon: '✅', sublabel: 'Valid outgoing' },
  broken: { bg: 'rgba(239,68,68,0.2)', color: '#ef4444', label: 'BROKEN', icon: '❌', sublabel: 'Missing targets' },
}

// Sort key when "Status" column header is clicked — surface the
// problematic categories first.
const STATUS_ORDER: Record<CoverageStatus, number> = {
  isolated: 0,
  orphan: 1,
  sink: 2,
  broken: 3,
  connected: 4,
}

type SortKey = 'name' | 'kind' | 'outgoing' | 'incoming' | 'status'

export function CoverageView({
  workspace,
  onNavigate,
}: {
  workspace: string
  /**
   * Click-to-open callback. Receives the symbol's full file path and its
   * name (used as the focus-symbol-id by `SylangFileEditor`). Plumbed from
   * the host's `/files` route so the editor switches files + scrolls the
   * symbol into view, mirroring how relation chips inside the editor work.
   */
  onNavigate?: (filePath: string, symbolId?: string) => void
}) {
  const [symbols, setSymbols] = useState<CoverageSymbol[]>([])
  const [summary, setSummary] = useState<CoverageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<CoverageStatus | ''>('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/sylang/coverage?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d: { ok?: boolean; symbols?: CoverageSymbol[]; summary?: CoverageSummary; error?: string }) => {
        if (cancelled) return
        if (d.ok && d.symbols && d.summary) {
          setSymbols(d.symbols)
          setSummary(d.summary)
        } else {
          setError(d.error ?? 'Failed to load coverage')
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspace])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sorted = symbols
    .filter((s) => !filterStatus || s.status === filterStatus)
    .sort((a, b) => {
      let cmp = 0
      if (sortKey === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      else if (sortKey === 'outgoing') cmp = a.outgoing - b.outgoing
      else if (sortKey === 'incoming') cmp = a.incoming - b.incoming
      else cmp = a[sortKey].localeCompare(b[sortKey])
      return sortAsc ? cmp : -cmp
    })

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-20 gap-3"
        style={{ color: 'var(--theme-muted)' }}
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        Analyzing coverage…
      </div>
    )
  }
  if (error) {
    return (
      <div
        className="mx-6 my-6 rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
        style={{ background: '#3f0f0f', color: '#f87171' }}
      >
        {error}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto px-6 py-6" style={{ color: 'var(--theme-text)' }}>
      {/* Status cards — clickable, double-tap clears the filter. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {(['isolated', 'orphan', 'sink', 'connected', 'broken'] as CoverageStatus[]).map((st) => {
          const c = STATUS_CONFIG[st]
          const active = filterStatus === st
          return (
            <button
              key={st}
              onClick={() => setFilterStatus(active ? '' : st)}
              className="rounded-xl px-4 py-3 text-left transition-all"
              style={{
                background: 'var(--theme-card)',
                border: active ? `2px solid ${c.color}` : '1px solid var(--theme-border)',
                borderLeft: `4px solid ${c.color}`,
              }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--theme-muted)' }}>
                {c.icon} {c.label}
              </div>
              <div className="text-2xl font-bold" style={{ color: c.color }}>
                {summary?.[st] ?? 0}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-muted)' }}>
                {c.sublabel}
              </div>
            </button>
          )
        })}
      </div>

      {/* Detail table. minWidth forces horizontal scroll on narrow panes
          instead of squashing the relationship columns. */}
      <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--theme-border)' }}>
        <table className="w-full text-sm" style={{ minWidth: 1200 }}>
          <thead>
            <tr style={{ background: 'var(--theme-card)' }}>
              {(
                [
                  ['name', 'Identifier'],
                  ['kind', 'Type'],
                ] as Array<[SortKey, string]>
              ).map(([k, l]) => (
                <th
                  key={k}
                  className="px-4 py-2.5 text-xs font-semibold text-left cursor-pointer"
                  style={{ color: sortKey === k ? 'var(--theme-accent)' : 'var(--theme-muted)' }}
                  onClick={() => handleSort(k)}
                >
                  {l}
                </th>
              ))}
              <th className="px-4 py-2.5 text-xs font-semibold text-left" style={{ color: 'var(--theme-muted)' }}>
                File
              </th>
              <th
                className="px-4 py-2.5 text-xs font-semibold text-left cursor-pointer"
                style={{ color: sortKey === 'status' ? 'var(--theme-accent)' : 'var(--theme-muted)' }}
                onClick={() => handleSort('status')}
              >
                Status
              </th>
              <th
                className="px-4 py-2.5 text-xs font-semibold text-right cursor-pointer"
                style={{ color: sortKey === 'outgoing' ? 'var(--theme-accent)' : 'var(--theme-muted)' }}
                onClick={() => handleSort('outgoing')}
              >
                Out
              </th>
              <th
                className="px-4 py-2.5 text-xs font-semibold text-right cursor-pointer"
                style={{ color: sortKey === 'incoming' ? 'var(--theme-accent)' : 'var(--theme-muted)' }}
                onClick={() => handleSort('incoming')}
              >
                In
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-right" style={{ color: 'var(--theme-muted)' }}>
                Broken
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-left" style={{ color: 'var(--theme-muted)' }}>
                Outgoing Relationships
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-left" style={{ color: 'var(--theme-muted)' }}>
                Incoming Relationships
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((sym, i) => {
              const sc = STATUS_CONFIG[sym.status]
              return (
                <tr
                  key={`${sym.name}-${i}`}
                  style={{ borderTop: '1px solid var(--theme-border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--theme-card)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-2 font-mono text-xs font-medium">
                    {onNavigate ? (
                      // Underlined-on-hover button so it reads as a link
                      // without forcing default <a> styling.
                      <button
                        onClick={() => onNavigate(sym.fileUri, sym.name)}
                        className="font-mono text-xs font-medium hover:underline cursor-pointer text-left"
                        style={{ color: 'var(--theme-accent)' }}
                        title={`Open ${sym.fileName} and scroll to ${sym.name}`}
                      >
                        {sym.name}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--theme-accent)' }}>{sym.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
                    >
                      {sym.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--theme-muted)' }}>
                    {sym.fileName}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded font-bold"
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums">{sym.outgoing}</td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums">{sym.incoming}</td>
                  <td
                    className="px-4 py-2 text-xs text-right tabular-nums"
                    style={{ color: sym.broken > 0 ? '#ef4444' : 'var(--theme-muted)' }}
                  >
                    {sym.broken}
                  </td>
                  <td className="px-4 py-2">
                    {sym.outgoingRelationships.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {sym.outgoingRelationships.map((r, j) => (
                          <div
                            key={j}
                            className="text-[11px] font-mono"
                            style={{
                              color: r.isValid ? 'var(--theme-muted)' : '#ef4444',
                              borderLeft: `3px solid ${r.isValid ? 'var(--theme-accent)' : '#ef4444'}`,
                              paddingLeft: 6,
                            }}
                          >
                            {r.sourceId} —{r.relationshipType}→ {r.targetId}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {sym.incomingRelationships.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {sym.incomingRelationships.map((r, j) => (
                          <div
                            key={j}
                            className="text-[11px] font-mono"
                            style={{
                              color: 'var(--theme-muted)',
                              borderLeft: '3px solid var(--theme-accent)',
                              paddingLeft: 6,
                            }}
                          >
                            {r.sourceId} —{r.relationshipType}→ {r.targetId}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CoverageView
