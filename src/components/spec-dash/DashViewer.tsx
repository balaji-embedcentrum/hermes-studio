/**
 * DashViewer — renders a `.dash` file as a sandboxed HTML dashboard.
 *
 * Server pipeline (`/api/sylang/dash-render`):
 *   dash text → @sylang/spec-dash DashParser → WebDashRenderer → HTML string
 *   (with inline Chart.js for metric/chart widgets)
 *
 * Same iframe-srcDoc + sandbox pattern as SpecViewer — the rendered
 * HTML is self-contained and isolated from the host.
 */
import { useEffect, useState } from 'react'

interface Props {
  filePath: string
  fileName: string
}

export function DashViewer({ filePath, fileName }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/sylang/dash-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; html?: string; error?: string }) => {
        if (cancelled) return
        if (d.ok && d.html) setHtml(d.html)
        else setError(d.error ?? 'Render returned no HTML')
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
  }, [filePath])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--theme-accent)' }}>
          DASH
        </span>
        <div className="w-px h-5 shrink-0" style={{ background: 'var(--theme-border)' }} />
        <span className="font-mono text-xs font-medium" style={{ color: 'var(--theme-text)' }}>
          {fileName}
        </span>
      </div>

      {loading && (
        <div
          className="flex items-center justify-center flex-1 gap-3"
          style={{ color: 'var(--theme-muted)' }}
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          Rendering dashboard…
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center justify-center flex-1">
          <div
            className="text-sm px-4 py-3 rounded-xl whitespace-pre-wrap max-w-xl"
            style={{ background: '#3f0f0f', color: '#f87171' }}
          >
            {error}
          </div>
        </div>
      )}

      {html && !loading && !error && (
        <iframe
          srcDoc={html}
          className="flex-1 min-h-0 w-full border-0"
          title={`Dashboard — ${fileName}`}
          sandbox="allow-scripts"
        />
      )}
    </div>
  )
}
