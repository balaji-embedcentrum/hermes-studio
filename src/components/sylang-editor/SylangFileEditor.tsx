/**
 * SylangFileEditor — renders Sylang DSL files via @sylang-core/react.
 *
 * Architecture: the actual TipTap editor lives in @sylang-core/web-editor and
 * runs inside an <iframe> served from public/sylang-editor/main.html. This
 * component is the host bridge — it reads the file, parses it to a
 * SylangTiptapDocument, hands the doc off to <SylangEditor />, and saves the
 * serialized DSL back when the editor reports a content change.
 */
import { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { localReadFile, localWriteFile } from '@/lib/local-file-ops'
import {
  SylangEditor,
  parseDSLToTiptap,
  serializeToDSL,
  isSylangFile,
  type SylangTiptapDocument,
} from '@sylang-core/react'

type SaveStatus = 'saved' | 'saving' | 'unsaved' | null

interface Props {
  filePath: string
  fileName: string
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

export function SylangFileEditor({ filePath, fileName, onNavigate }: Props) {
  const fileExtension = getFileExtension(fileName)
  const [doc, setDoc] = useState<SylangTiptapDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originalContentRef = useRef<string>('')
  const postRef = useRef<((msg: unknown) => void) | null>(null)
  const localAgentUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])

  // Workspace prefix is the first three path segments: <userId>/<login>/<repo>.
  // Used to scope iframe-side requests (symbol lookups etc.) to the right
  // workspace and to translate symbol-id navigation back into a file path.
  const workspacePrefix = filePath.split('/').filter(Boolean).slice(0, 3).join('/')

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
  }, [filePath, fileExtension, localAgentUrl, activeWorkspacePath])

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
      {/* The iframe-mounted editor draws its own breadcrumb + title +
          action toolbar (refresh / search / download / overflow). Adding
          another header stripe here stacks two of them and pushes the
          hermes-studio top bar (session timer / branding) off-screen.
          Save status moves to a small floating badge instead. */}

      {saveStatus && !loading && !error && (
        <div
          className="absolute top-2 right-3 z-10 px-2 py-0.5 rounded text-[11px] font-medium pointer-events-none"
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

      {loading && (
        <div
          className="flex items-center justify-center flex-1 gap-3"
          style={{ color: 'var(--theme-muted)' }}
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <span className="text-sm">Loading {fileName}…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center flex-1">
          <div
            className="text-sm px-4 py-3 rounded-xl"
            style={{ background: '#3f0f0f', color: '#f87171' }}
          >
            {error}
          </div>
        </div>
      )}

      {doc && !loading && !error && (
        <div className="flex-1 min-h-0">
          <SylangEditor
            document={doc}
            fileExtension={fileExtension}
            fileName={fileName}
            relativePath={filePath}
            onChange={handleChange}
            bundleUrl="/sylang-editor/main.html"
            theme="dark"
            onReady={(post) => {
              postRef.current = post
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

                // ── Stub responses (so the iframe doesn't hang) ─────────────
                // These would normally be backed by /api/sylang/* endpoints
                // (port pending). Replying with empty results is enough to
                // close the loading spinners — features will light up once
                // the corresponding server routes land.
                //
                // getDiagram is special: the webview doesn't use requestId
                // for it. It waits for a *type-keyed* reply { type:
                // 'diagramData', data, diagramType }. Sending data: null
                // terminates the spinner and shows the empty-state.
                case 'getDiagram':
                  postRef.current?.({ type: 'diagramData', data: null, diagramType: null })
                  return
                case 'getVariantMatrix':
                  postRef.current?.({ type: 'variantMatrixData', data: null })
                  return
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
                    colorPalette: 'teal',
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
