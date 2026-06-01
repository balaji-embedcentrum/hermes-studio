/**
 * TraceabilityView — renders the workspace-wide graph (every symbol + every
 * relationship) using the `SigmaGraphTraversal` component from
 * `@sylang/web-diagrams`'s focused library entry. Mounted inline (no
 * iframe) since the component is pure SVG/D3 + inline styles, with no
 * `position: fixed` panels or global CSS that could leak into the host.
 *
 * Data flow:
 *   GET /api/sylang/traceability?workspace=…
 *     → WebDiagramTransformer.transformToGraphTraversal()
 *     → { nodes: GraphNode[], edges: GraphEdge[], ...metadata }
 *
 * Same `ServerSymbolManager.allDocuments` source as diagrams,
 * coverage, FMEA, and spec-dash, so the graph reflects current edits.
 */
import { Suspense, lazy, useEffect, useState } from 'react'
import type { GraphTraversalData } from '@sylang/web-diagrams'

// Lazy-load the renderer — it pulls in d3 (~80 KB) which we only want
// to fetch when the user actually opens the view.
const SigmaGraphTraversal = lazy(() =>
  import('@sylang/web-diagrams').then((m) => ({ default: m.SigmaGraphTraversal })),
)

export function TraceabilityView({ workspace }: { workspace: string }) {
  const [graphData, setGraphData] = useState<GraphTraversalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setGraphData(null)
    fetch(`/api/sylang/traceability?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d: { ok?: boolean; data?: GraphTraversalData; error?: string }) => {
        if (cancelled) return
        if (d.ok && d.data) setGraphData(d.data)
        else setError(d.error ?? 'Failed to build traceability graph')
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

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-20 gap-3"
        style={{ color: 'var(--theme-muted)' }}
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        Building traceability graph…
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
  if (!graphData) return null

  // 100% height resolves correctly because SylangFileEditor wraps inline
  // views in `flex-1 min-h-0 overflow-hidden`. SigmaGraphTraversal sizes
  // its SVG to the container.
  return (
    <div style={{ height: '100%', width: '100%', minHeight: 500 }}>
      <Suspense
        fallback={
          <div
            className="flex items-center justify-center py-20 gap-3"
            style={{ color: 'var(--theme-muted)' }}
          >
            Loading graph renderer…
          </div>
        }
      >
        <SigmaGraphTraversal data={graphData} theme="dark" />
      </Suspense>
    </div>
  )
}

export default TraceabilityView
