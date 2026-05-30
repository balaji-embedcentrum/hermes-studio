/**
 * SylangFileEditor — renders Sylang DSL files via @sylang/react.
 *
 * Architecture: the actual TipTap editor lives in @sylang/web-editor and
 * runs inside an <iframe> served from public/sylang-editor/main.html. This
 * component is the host bridge — it reads the file, parses it to a
 * SylangTiptapDocument, hands the doc off to <SylangEditor />, and saves the
 * serialized DSL back when the editor reports a content change.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { getTheme, isDarkTheme, isValidTheme } from '@/lib/theme'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { localReadFile, localWriteFile } from '@/lib/local-file-ops'
import {
  SylangEditor,
  parseDSLToTiptap,
  serializeToDSL,
  isSylangFile,
  type SylangTiptapDocument,
} from '@sylang/react'
import { NestMenuBar } from './nest-menu-bar'

// Inline views are lazy-loaded to keep the initial editor bundle small.
// Each one is a self-contained React component bound to an analysis API
// route. New views (Coverage, Traceability, etc.) follow the same shape
// and slot into the switch at the bottom of this file.
const FmeaView = lazy(() => import('./inline-views/fmea-view'))
const CoverageView = lazy(() => import('./inline-views/coverage-view'))
const TraceabilityView = lazy(() => import('./inline-views/traceability-view'))

type SaveStatus = 'saved' | 'saving' | 'unsaved' | null

interface Props {
  filePath: string
  fileName: string
  /** When set, after the editor has rendered the document, scroll to and
   *  highlight this symbol. Used by click-to-id navigation. */
  focusSymbolId?: string
  /**
   * Called when the iframe asks to navigate to a different file (clicking a
   * relation chip / linked id). The /files route handles this by updating its
   * selectedFile state — we deliberately don't change the URL, otherwise the
   * file-explorer sidebar refetches the tree against a *file* path and shows
   * "No workspace selected".
   */
  onNavigate?: (path: string, symbolId?: string) => void
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx) : ''
}

export { isSylangFile }

/**
 * Resolve the editor iframe's light/dark mode from the live `<html
 * data-theme>` — the single source of truth that `setTheme()` and the
 * __root bootstrap script authoritatively maintain. We deliberately do
 * NOT use a one-shot `isDarkTheme(getTheme())`: `getTheme()` reads
 * `localStorage` directly and is non-reactive, so a legacy `hermes-*`
 * value (still valid in THEME_SET) or the SSR→client/migration ordering
 * could lock the iframe to the wrong theme even after the host settles
 * on the editorial light theme. Reading the DOM attribute makes the
 * editor always match what the user actually sees.
 */
function readDocThemeMode(): 'dark' | 'light' {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr && isValidTheme(attr)) return isDarkTheme(attr) ? 'dark' : 'light'
  }
  return isDarkTheme(getTheme()) ? 'dark' : 'light'
}

function useLiveEditorThemeMode(): 'dark' | 'light' {
  const [mode, setMode] = useState<'dark' | 'light'>(readDocThemeMode)
  useEffect(() => {
    const root = document.documentElement
    const update = () => setMode(readDocThemeMode())
    update() // reconcile any post-hydration / migration change
    const obs = new MutationObserver(update)
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return mode
}

export function SylangFileEditor({ filePath, fileName, focusSymbolId, onNavigate }: Props) {
  const fileExtension = getFileExtension(fileName)
  const editorThemeMode = useLiveEditorThemeMode()
  const [editorReady, setEditorReady] = useState(false)
  const [doc, setDoc] = useState<SylangTiptapDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Which inline view (FMEA, Coverage, …) is currently overriding the
  // editor body. `null` means "show the regular Sylang editor". Each
  // sylang file gets its own activeView state — switching files resets
  // it back to null via the useEffect below.
  const [activeView, setActiveView] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originalContentRef = useRef<string>('')
  const postRef = useRef<((msg: unknown) => void) | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  // Latest resolved mode, read inside onReady (which fires on every iframe
  // load/reload) without capturing a stale closure value.
  const themeModeRef = useRef(editorThemeMode)
  themeModeRef.current = editorThemeMode
  const localAgentUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])

  // Force the iframe's light/dark mode via the editor bundle's own
  // `setTheme` postMessage channel. The bundle reads the URL `?theme=`
  // ONLY once at startup and otherwise falls back to matchMedia (which
  // defaults to *dark*). Behind a CDN / with a cached iframe that URL
  // path is unreliable — which is why .vml/.vcf kept rendering dark even
  // with the correct theme prop. `setTheme` does a reliable
  // remove-both + add-correct on the live iframe, so drive it explicitly
  // once the editor is ready and again on every host theme change.
  useEffect(() => {
    if (!editorReady) return
    postRef.current?.({ type: 'setTheme', theme: editorThemeMode })
  }, [editorReady, editorThemeMode])

  // Bulletproof theme enforcement. The editor iframe is SAME-ORIGIN
  // (/sylang-editor/* on this domain, sandbox allows same-origin), and
  // every indirect channel proved unreliable in production: the bundle
  // reads ?theme= once then falls back to matchMedia (defaults to dark),
  // its CSS has no :root fallback for --vscode-editor-background (so a
  // wrong/missing body theme class makes the block cards transparent
  // over a dark backdrop), and postMessage timing behind the CDN didn't
  // stick. So we reach into the iframe document directly and (a) inject a
  // :root fallback for the editor-bg/fg vars and (b) keep its
  // <body class="sylang-theme-*"> in sync with the host — re-asserting
  // via a MutationObserver if the bundle's own startup flips it back.
  useEffect(() => {
    const hostMode = (): 'dark' | 'light' =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light'

    let bodyObs: MutationObserver | null = null
    let watchedBody: HTMLElement | null = null

    const enforce = () => {
      const iframe =
        editorContainerRef.current?.querySelector<HTMLIFrameElement>('iframe')
      if (!iframe) return
      let idoc: Document | null = null
      try {
        idoc = iframe.contentDocument
      } catch {
        return // cross-origin (shouldn't happen) — give up silently
      }
      if (!idoc || !idoc.documentElement) return
      const mode = hostMode()

      // (a) :root fallback so the bg vars are ALWAYS defined, even before
      //     the bundle adds its body theme class.
      const head = idoc.head || idoc.documentElement
      let style = idoc.getElementById(
        '__host_theme_fallback',
      ) as HTMLStyleElement | null
      if (!style) {
        style = idoc.createElement('style')
        style.id = '__host_theme_fallback'
        head.appendChild(style)
      }
      const bg = mode === 'dark' ? '#1e1e1e' : '#ffffff'
      const fg = mode === 'dark' ? '#d4d4d4' : '#1f2937'
      const css = `:root{--vscode-editor-background:${bg};--vscode-editor-foreground:${fg};}`
      if (style.textContent !== css) style.textContent = css

      // (b) keep the body theme class correct (check-before-write avoids
      //     observer feedback loops).
      const body = idoc.body
      if (body) {
        const want = `sylang-theme-${mode}`
        const drop = `sylang-theme-${mode === 'dark' ? 'light' : 'dark'}`
        if (body.classList.contains(drop)) body.classList.remove(drop)
        if (!body.classList.contains(want)) body.classList.add(want)

        // Re-assert if the bundle's startup script flips the class back.
        if (watchedBody !== body) {
          bodyObs?.disconnect()
          bodyObs = new MutationObserver(() => {
            const m = hostMode()
            const w = `sylang-theme-${m}`
            const d = `sylang-theme-${m === 'dark' ? 'light' : 'dark'}`
            if (body.classList.contains(d) || !body.classList.contains(w)) {
              body.classList.remove(d)
              body.classList.add(w)
            }
          })
          bodyObs.observe(body, {
            attributes: true,
            attributeFilter: ['class'],
          })
          watchedBody = body
        }
      }
    }

    // Acquire the iframe (rendered async by <SylangEditor>) and re-enforce
    // across its load + the bundle's slightly-later startup.
    let tries = 0
    const poll = window.setInterval(() => {
      tries += 1
      const iframe =
        editorContainerRef.current?.querySelector<HTMLIFrameElement>('iframe')
      if (iframe) {
        enforce()
        iframe.addEventListener('load', enforce)
      }
      if (tries > 40) window.clearInterval(poll) // ~12s safety cap
    }, 300)

    // Follow host theme switches.
    const rootObs = new MutationObserver(enforce)
    rootObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    return () => {
      window.clearInterval(poll)
      rootObs.disconnect()
      bodyObs?.disconnect()
      const iframe =
        editorContainerRef.current?.querySelector<HTMLIFrameElement>('iframe')
      iframe?.removeEventListener('load', enforce)
    }
  }, [doc])

  // Workspace prefix is the first three path segments: <userId>/<login>/<repo>.
  // Used to scope iframe-side requests (symbol lookups etc.) to the right
  // workspace and to translate symbol-id navigation back into a file path.
  const workspacePrefix = filePath.split('/').filter(Boolean).slice(0, 3).join('/')

  // Incremented when the user hits the manual "Reload" button. Plumbed into
  // both the doc-load effect (re-fetches file content from /api/files) and
  // as a React `key` on the iframe + inline view (forces full remount, so
  // anything they read — blocks, diagrams, matrices, FMEA — re-issues its
  // fetches against the always-fresh server cache landed in #58). Use this
  // when the agent has edited files in the background and the open view
  // looks stale; no need to switch projects or log out anymore.
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Reset the active inline view whenever the user navigates to a
  // different sylang file. Without this, opening File A → switching to
  // its FMEA view → opening File B would leave File B showing File A's
  // FMEA workbench.
  useEffect(() => {
    setActiveView(null)
  }, [filePath])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      try {
        let rawContent: string
        if (localAgentUrl && activeWorkspacePath) {
          const result = await localReadFile(localAgentUrl, activeWorkspacePath, filePath)
          rawContent = result.content
        } else {
          const res = await fetch(`/api/files?action=read&path=${encodeURIComponent(filePath)}`)
          if (!res.ok) throw new Error(`Cannot read file: HTTP ${res.status}`)
          const data = (await res.json()) as { content?: string }
          rawContent = data.content ?? ''
        }

        const content = rawContent ?? ''
        const tiptapDoc = parseDSLToTiptap(content, fileExtension) as SylangTiptapDocument

        if (!cancelled) {
          originalContentRef.current = content
          setDoc(tiptapDoc)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [filePath, fileExtension, localAgentUrl, activeWorkspacePath, refreshNonce])

  const handleChange = (next: unknown) => {
    setDoc(next as SylangTiptapDocument)
    setSaveStatus('unsaved')
    if (pendingSave.current) clearTimeout(pendingSave.current)

    pendingSave.current = setTimeout(async () => {
      const original = originalContentRef.current
      let text: string
      try {
        text = serializeToDSL(next as SylangTiptapDocument, fileExtension)
      } catch (e) {
        console.error('[sylang] serializeToDSL threw — refusing to save', e)
        setSaveStatus('unsaved')
        return
      }

      // Safety: never write content that is dramatically smaller than the
      // original. Catches any future parser/serializer round-trip regression
      // that would silently destroy a file's contents.
      if (original.length > 50 && text.length < original.length * 0.5) {
        console.warn('[sylang] refusing to save — serialized content is dramatically smaller', {
          originalLength: original.length,
          newLength: text.length,
        })
        setSaveStatus('unsaved')
        return
      }

      if (text === original) {
        setSaveStatus('saved')
        return
      }

      setSaveStatus('saving')
      try {
        if (localAgentUrl && activeWorkspacePath) {
          await localWriteFile(localAgentUrl, activeWorkspacePath, filePath, text)
        } else {
          await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'write', path: filePath, content: text }),
          })
        }
        originalContentRef.current = text
        setSaveStatus('saved')
      } catch (e) {
        console.error('[sylang] save failed:', e)
        setSaveStatus('unsaved')
      }
    }, 1500)
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* NestMenuBar — Analysis + Process dropdowns. Sits ABOVE the
          editor iframe so it never disappears when the iframe takes
          focus. Git intentionally skipped (host has a richer git panel
          via /api/git already). */}
      <div
        className="flex items-center gap-3 px-3 py-1 border-b shrink-0"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
      >
        <NestMenuBar
          workspacePath={filePath}
          onViewChange={(v) => setActiveView(v)}
        />
        {activeView && (
          <button
            onClick={() => setActiveView(null)}
            className="text-xs px-2 py-0.5 rounded font-medium hover:bg-white/10"
            style={{ color: 'var(--theme-accent)' }}
          >
            ← Back to Editor
          </button>
        )}
      </div>

      {/* When an inline view is active, render it instead of the
          TipTap iframe. Inline views are lazy()'d, so the user pays
          their bundle cost only on first open. */}
      {activeView && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense
            fallback={
              <div
                className="flex items-center justify-center py-20 gap-3"
                style={{ color: 'var(--theme-muted)' }}
              >
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                Loading {activeView}…
              </div>
            }
          >
            <InlineView
              key={`inline-${refreshNonce}`}
              view={activeView}
              workspace={workspacePrefix}
              onNavigate={onNavigate}
            />
          </Suspense>
        </div>
      )}

      {/* The iframe-mounted editor draws its own breadcrumb + title +
          action toolbar (refresh / search / download / overflow). Adding
          another header stripe here stacks two of them and pushes the
          hermes-studio top bar (session timer / branding) off-screen.
          Save status + manual reload move to small floating badges instead. */}

      {!loading && !error && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
          {!activeView && saveStatus && (
            <div
              className="px-2 py-0.5 rounded text-[11px] font-medium pointer-events-none"
              style={{
                background: 'var(--theme-sidebar, rgba(0,0,0,0.6))',
                color: 'var(--theme-muted, #9ca3af)',
                border: '1px solid var(--theme-border, rgba(255,255,255,0.1))',
              }}
            >
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'saved' && '✓ Saved'}
              {saveStatus === 'unsaved' && '● Unsaved'}
            </div>
          )}
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            title="Re-read file from disk and re-parse symbols. Use this if an agent edited files and the view looks stale."
            className="px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors"
            style={{
              background: 'var(--theme-sidebar, rgba(0,0,0,0.6))',
              color: 'var(--theme-fg, #e5e7eb)',
              border: '1px solid var(--theme-border, rgba(255,255,255,0.1))',
            }}
          >
            ↻ Reload
          </button>
        </div>
      )}

      {!activeView && loading && (
        <div
          className="flex items-center justify-center flex-1 gap-3"
          style={{ color: 'var(--theme-muted)' }}
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <span className="text-sm">Loading {fileName}…</span>
        </div>
      )}

      {!activeView && error && (
        <div className="flex items-center justify-center flex-1">
          <div
            className="text-sm px-4 py-3 rounded-xl"
            style={{ background: '#3f0f0f', color: '#f87171' }}
          >
            {error}
          </div>
        </div>
      )}

      {!activeView && doc && !loading && !error && (
        <div ref={editorContainerRef} className="flex-1 min-h-0">
          <SylangEditor
            key={`editor-${refreshNonce}`}
            document={doc}
            fileExtension={fileExtension}
            fileName={fileName}
            relativePath={filePath}
            focusSymbolId={focusSymbolId}
            onChange={handleChange}
            bundleUrl="/sylang-editor/main.html"
            theme={editorThemeMode}
            colorPalette="orange"
            onReady={(post) => {
              postRef.current = post
              // Push the correct theme the moment the iframe is ready —
              // covers the initial load and every reload (the bundle
              // re-runs its dark-defaulting matchMedia fallback on each).
              post({ type: 'setTheme', theme: themeModeRef.current })
              setEditorReady(true)
            }}
            onMessage={(raw) => {
              const msg = raw as
                | {
                    type?: string
                    requestId?: string
                    symbolId?: string
                    fileUri?: string
                    path?: string
                    [k: string]: unknown
                  }
                | null
              if (!msg || typeof msg !== 'object') return
              const reply = (result: unknown, ok = true, error?: string) => {
                if (!msg.requestId) return
                postRef.current?.({ requestId: msg.requestId, ok, result, error })
              }

              switch (msg.type) {
                case 'log':
                  // forward iframe debug logs to the host console
                  console.info('[sylang]', msg)
                  return

                // ── Navigation ──────────────────────────────────────────────
                case 'openSymbolById': {
                  // Resolve symbol → filePath via the server-side symbol cache,
                  // then ask the host route to switch files. The iframe
                  // sometimes attaches a fileUri hint (when it already knows
                  // where the symbol lives); we honour it and skip the lookup.
                  const symbolId =
                    typeof msg.symbolId === 'string' ? msg.symbolId : ''
                  const direct =
                    typeof msg.fileUri === 'string' && msg.fileUri ? msg.fileUri : ''
                  if (direct) {
                    onNavigateRef.current?.(direct, symbolId || undefined)
                    return
                  }
                  if (!symbolId) return
                  void (async () => {
                    try {
                      const params = new URLSearchParams({
                        id: symbolId,
                        workspacePath: filePath,
                      })
                      const res = await fetch(
                        `/api/sylang/symbol-details?${params.toString()}`,
                      )
                      if (!res.ok) return
                      const data = (await res.json()) as {
                        ok?: boolean
                        symbol?: { filePath?: string }
                      }
                      const target = data.ok && data.symbol?.filePath
                      if (typeof target === 'string' && target) {
                        onNavigateRef.current?.(target, symbolId)
                      }
                    } catch (e) {
                      console.warn('[sylang] openSymbolById failed', e)
                    }
                  })()
                  return
                }
                case 'openFile': {
                  if (typeof msg.path === 'string' && msg.path) {
                    onNavigateRef.current?.(msg.path)
                  }
                  return
                }

                // ── Diagrams (issue #1) ─────────────────────────────────────
                // The iframe sends { type: 'getDiagram', fileExtension }
                // and waits for a TYPE-KEYED reply (no requestId):
                //   { type: 'diagramData', diagramType, data, error? }
                // The diagram type is inferred from the active file extension.
                case 'getDiagram': {
                  const extToType: Record<string, string> = {
                    '.fml': 'feature-model',
                    '.vml': 'variant-model',
                    '.blk': 'internal-block-diagram',
                    '.fun': 'functional-decomposition',
                    '.ucd': 'use-case-diagram',
                    '.seq': 'sequence-diagram',
                    '.flr': 'fmea-diagram',
                    '.smd': 'state-machine-diagram',
                    '.fta': 'fault-tree-analysis',
                  }
                  const msgExt =
                    (msg as { fileExtension?: string }).fileExtension ?? fileExtension
                  const resolvedDiagramType = extToType[msgExt]
                  if (!resolvedDiagramType) {
                    postRef.current?.({
                      type: 'diagramData',
                      error: `No diagram type for extension ${msgExt}`,
                    })
                    return
                  }
                  void (async () => {
                    try {
                      const res = await fetch('/api/sylang/diagram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath, diagramType: resolvedDiagramType }),
                      })
                      const data = (await res.json()) as {
                        ok: boolean
                        data?: unknown
                        error?: string
                      }
                      postRef.current?.({
                        type: 'diagramData',
                        diagramType: resolvedDiagramType,
                        data: data.data,
                        error: data.error,
                      })
                    } catch (e) {
                      postRef.current?.({ type: 'diagramData', error: String(e) })
                    }
                  })()
                  return
                }

                // ── Variant matrix (issue #2) ───────────────────────────────
                // GET — { type: 'getVariantMatrix' } → { type: 'variantMatrixData', data }.
                case 'getVariantMatrix': {
                  void (async () => {
                    try {
                      const res = await fetch(
                        `/api/sylang/variant-matrix?path=${encodeURIComponent(filePath)}`,
                      )
                      const data = (await res.json()) as {
                        ok: boolean
                        matrix?: unknown
                        error?: string
                      }
                      if (data.ok) {
                        postRef.current?.({ type: 'variantMatrixData', data: data.matrix })
                      } else {
                        postRef.current?.({
                          type: 'variantMatrixError',
                          error: data.error ?? 'Failed to load variant matrix',
                        })
                      }
                    } catch (e) {
                      postRef.current?.({ type: 'variantMatrixError', error: String(e) })
                    }
                  })()
                  return
                }
                case 'toggleFeature': {
                  const variantPath =
                    typeof msg.variantPath === 'string' ? msg.variantPath : ''
                  const featureId =
                    typeof msg.featureId === 'string' ? msg.featureId : ''
                  const selected = Boolean(msg.selected)
                  if (!variantPath || !featureId) return
                  void (async () => {
                    try {
                      const res = await fetch('/api/sylang/variant-matrix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'toggleFeature',
                          variantPath,
                          featureId,
                          selected,
                        }),
                      })
                      const data = (await res.json()) as {
                        ok: boolean
                        variantName?: string
                        error?: string
                      }
                      if (data.ok) {
                        postRef.current?.({
                          type: 'featureToggled',
                          variantName: data.variantName,
                          featureId,
                          selected,
                        })
                      } else {
                        console.warn('[toggleFeature]', data.error)
                      }
                    } catch (e) {
                      console.error('[toggleFeature]', e)
                    }
                  })()
                  return
                }
                case 'createVariant': {
                  const variantId =
                    typeof msg.variantId === 'string' ? msg.variantId : ''
                  const vName =
                    typeof msg.variantName === 'string' ? msg.variantName : ''
                  const description =
                    typeof msg.description === 'string' ? msg.description : ''
                  const owner =
                    typeof msg.owner === 'string' ? msg.owner : ''
                  if (!variantId) return
                  void (async () => {
                    try {
                      const res = await fetch('/api/sylang/variant-matrix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'createVariant',
                          fmlPath: filePath,
                          variantId,
                          variantName: vName,
                          description,
                          owner,
                        }),
                      })
                      const data = (await res.json()) as {
                        ok: boolean
                        name?: string
                        path?: string
                        error?: string
                      }
                      if (data.ok) {
                        postRef.current?.({
                          type: 'variantCreated',
                          name: data.name,
                          path: data.path,
                          success: true,
                        })
                      } else {
                        console.warn('[createVariant]', data.error)
                      }
                    } catch (e) {
                      console.error('[createVariant]', e)
                    }
                  })()
                  return
                }
                case 'selectVariantForVcf': {
                  const vmlPath = typeof msg.vmlPath === 'string' ? msg.vmlPath : ''
                  const svName =
                    typeof msg.variantName === 'string' ? msg.variantName : ''
                  if (!vmlPath) return
                  void (async () => {
                    try {
                      const res = await fetch('/api/sylang/variant-matrix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'selectVariantForVcf',
                          vmlPath,
                          variantName: svName,
                        }),
                      })
                      const data = (await res.json()) as { ok: boolean; error?: string }
                      if (!data.ok) console.warn('[selectVariantForVcf]', data.error)
                    } catch (e) {
                      console.error('[selectVariantForVcf]', e)
                    }
                  })()
                  return
                }
                // The iframe expects a type-keyed reply { type:
                // 'symbolDetails', requestId, ok, symbol } — NOT the generic
                // requestId-only shape. The shape of `symbol` matches what
                // SymbolTooltip renders: id, kind, type, properties, fileName,
                // filePath, line.
                case 'getSymbolDetails': {
                  const requestId = msg.requestId
                  const symbolId =
                    typeof msg.symbolId === 'string' ? msg.symbolId : ''
                  if (!requestId || !symbolId) return
                  void (async () => {
                    try {
                      const params = new URLSearchParams({
                        id: symbolId,
                        workspacePath: filePath,
                      })
                      const res = await fetch(
                        `/api/sylang/symbol-details?${params.toString()}`,
                      )
                      const data = (await res.json().catch(() => ({}))) as {
                        ok?: boolean
                        symbol?: {
                          name: string
                          kind: string
                          type: string
                          properties: Record<string, string>
                          fileName: string
                          filePath: string
                          line: number
                        }
                      }
                      const ok = !!(data.ok && data.symbol)
                      const sym = data.symbol
                      postRef.current?.({
                        type: 'symbolDetails',
                        requestId,
                        ok,
                        symbol: ok && sym
                          ? {
                              id: sym.name,
                              kind: sym.kind,
                              type: sym.type,
                              properties: sym.properties,
                              fileName: sym.fileName,
                              filePath: sym.filePath,
                              line: sym.line,
                            }
                          : null,
                      })
                    } catch {
                      postRef.current?.({
                        type: 'symbolDetails',
                        requestId,
                        ok: false,
                        symbol: null,
                      })
                    }
                  })()
                  return
                }
                case 'getSlashCompletions':
                  reply({ items: [] })
                  return
                case 'getPropertySchema':
                  reply({ schema: [] })
                  return
                case 'getBacklinks':
                  reply([])
                  return
                case 'pickAttachment':
                case 'pickReqAttachment':
                  reply(null)
                  return
                case 'resolveDocAsset':
                case 'resolveReqAsset':
                  reply({ webviewUri: '' })
                  return
                case 'requestDocument':
                  // The iframe is asking for the doc again; resend it.
                  postRef.current?.({
                    type: 'init',
                    document: doc,
                    fileExtension,
                    fileName,
                    relativePath: filePath,
                    colorPalette: 'orange',
                    disabledBlockIds: [],
                  })
                  return

                default:
                  return
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * InlineView — single switch routing NestMenuBar's view keys to the
 * concrete view component. Kept as a thin switch so adding Coverage,
 * Traceability, etc. is a one-line change once their components land.
 *
 * `iso26262` and `aspice` are intentionally placeholders — sylang-hermes
 * doesn't implement them either; we keep the menu entries so the shape
 * matches and add real impls when the analyzer logic lands in sylang-core.
 */
function InlineView({
  view,
  workspace,
  onNavigate,
}: {
  view: string
  workspace: string
  /**
   * Forwarded so coverage's clickable identifiers can switch the active
   * file just like the editor's own relation chips do. Other views (FMEA,
   * traceability) handle navigation internally for now.
   */
  onNavigate?: (path: string, symbolId?: string) => void
}) {
  switch (view) {
    case 'fmea':
      return <FmeaView workspace={workspace} />
    case 'coverage':
      return <CoverageView workspace={workspace} onNavigate={onNavigate} />
    case 'traceability':
      return <TraceabilityView workspace={workspace} />
    case 'iso26262':
    case 'aspice':
      return <ComingSoon view={view} />
    default:
      return <ComingSoon view={view} />
  }
}

function ComingSoon({ view }: { view: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-20 text-center"
      style={{ color: 'var(--theme-muted)' }}
    >
      <div className="text-base font-medium" style={{ color: 'var(--theme-text)' }}>
        {view} — coming soon
      </div>
      <div className="text-sm">This view isn't ported into hermes-studio-sylang yet.</div>
    </div>
  )
}
