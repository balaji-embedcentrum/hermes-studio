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
import { useNavigate } from '@tanstack/react-router'
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
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx) : ''
}

export { isSylangFile }

export function SylangFileEditor({ filePath, fileName }: Props) {
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
  const navigate = useNavigate()

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
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--theme-accent)' }}>
            sylang
          </span>
          <span className="text-xs uppercase" style={{ color: 'var(--theme-muted)' }}>
            {fileExtension}
          </span>
        </div>
        <div className="w-px h-5 shrink-0" style={{ background: 'var(--theme-border)' }} />
        <span className="font-mono text-xs font-medium" style={{ color: 'var(--theme-text)' }}>
          {fileName}
        </span>
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && '✓ Saved'}
          {saveStatus === 'unsaved' && '● Unsaved'}
        </span>
      </div>

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
                  // Symbol click. We don't yet have a server-side symbol index
                  // so we can only navigate when the iframe also gives us a
                  // fileUri. Otherwise this is a no-op (graceful degradation).
                  const target = msg.fileUri
                  if (typeof target === 'string' && target) {
                    void navigate({
                      to: '/files',
                      search: { path: target },
                    } as never)
                  }
                  return
                }
                case 'openFile': {
                  if (typeof msg.path === 'string' && msg.path) {
                    void navigate({
                      to: '/files',
                      search: { path: msg.path },
                    } as never)
                  }
                  return
                }

                // ── Stub responses (so the iframe doesn't hang) ─────────────
                // These would normally be backed by /api/sylang/* endpoints
                // (port pending). Replying with empty results is enough to
                // close the loading spinners — features will light up once
                // the corresponding server routes land.
                case 'getDiagram':
                case 'getVariantMatrix':
                  reply(null, false, 'Not yet implemented in @sylang-core')
                  return
                case 'getSymbolDetails':
                  reply({ symbol: null })
                  return
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
