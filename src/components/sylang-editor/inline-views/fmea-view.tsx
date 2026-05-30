/**
 * FmeaView — embeds the FMEA workbench as an iframe pointing at
 * /sylang-fmea/main.html (the Vite-built bundle from
 * @sylang/fmea-view, synced via `pnpm sync:editor:fmea`).
 *
 * Why iframe and not library mount:
 *   The FMEA app uses `position: fixed` for its SidePanel + CauseEffectPanel
 *   and ships global `body`/`html` CSS rules. Mounted inline those panels
 *   anchor to the host viewport (covering the chat + sidebar), and the
 *   global styles squash the host's top bar. An iframe gives each instance
 *   its own viewport so fixed-positioned children stay inside the editor
 *   pane and the FMEA's CSS can't leak into Hermes Studio.
 *
 * Data flow (same cache as diagrams + spec-dash, so edits propagate):
 *   GET /api/sylang/fmea?workspace=…
 *     → ServerSymbolManager.allDocuments
 *     → FMEASymbol[]
 *
 *   then, once the iframe posts `{type:'fmeaReady'}`:
 *     → postMessage({type:'loadSymbols', symbols}) into the iframe
 *
 * The `fmeaReady` ↔ `loadSymbols` handshake (and the VSCode API shim that
 * forwards `acquireVsCodeApi().postMessage` to `window.parent`) is set up
 * in @sylang/fmea-view/src/main.tsx.
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Workspace path in the form "userId/owner/repo". */
  workspace: string
}

export function FmeaView({ workspace }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [symbols, setSymbols] = useState<unknown[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // 1. Fetch symbols from the host's shared cache.
  useEffect(() => {
    let cancelled = false
    setError(null)
    setSymbols(null)
    fetch(`/api/sylang/fmea?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((d: { ok?: boolean; symbols?: unknown[]; error?: string }) => {
        if (cancelled) return
        if (d.ok && Array.isArray(d.symbols)) setSymbols(d.symbols)
        else setError(d.error ?? 'Failed to load FMEA data')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [workspace])

  // 2. Listen for `fmeaReady` (the iframe announces it once main.tsx
  //    has mounted its message listener). We can't just postMessage on
  //    `onLoad` — the listener may not be attached yet, and the message
  //    would be dropped.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'fmeaReady') setReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // 3. Once we have both symbols *and* the iframe is ready, send them.
  useEffect(() => {
    if (!ready || !symbols || !iframeRef.current?.contentWindow) return
    iframeRef.current.contentWindow.postMessage(
      { type: 'loadSymbols', symbols },
      '*',
    )
  }, [ready, symbols])

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

  // The container provides the height the iframe stretches into. Parent
  // (SylangFileEditor) already gives us `flex-1 min-h-0 overflow-hidden`,
  // so 100%/100% here resolves to a real pixel size instead of collapsing.
  return (
    <iframe
      ref={iframeRef}
      src="/sylang-fmea/main.html"
      title="FMEA Workbench"
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: '100%',
        height: '100%',
        border: 0,
        display: 'block',
        background: '#ffffff',
      }}
    />
  )
}

export default FmeaView
