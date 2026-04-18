/**
 * JotxFileEditor — renders .jot files using @jotx-labs/editor
 *
 * Pipeline: .jot text → Parser → AST blocks → TiptapAdapter → Tiptap JSON → JotxEditor
 * On save: Tiptap JSON → Serializer → .jot text → /api/files POST
 */
import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { localReadFile, localWriteFile } from '@/lib/local-file-ops'
import { Parser, Serializer } from '@jotx-labs/core'
import { BlockRegistry } from '@jotx-labs/registry'
import { registerStandardBlocks } from '@jotx-labs/standard-lib'
import { TiptapAdapter } from '@jotx-labs/adapters/dist/editor'

// Lazy load JotxEditor — it imports CSS via require() which crashes SSR
const JotxEditorLazy = lazy(() =>
  import('@jotx-labs/editor').then(m => ({
    default: ({ documentId, documentType, tiptapDoc, onChange, ribbonExpanded, editable, bridge }: any) => {
      // Import CSS on client side
      import('./jotx-editor.css').catch(() => {})
      return (
        <m.BridgeProvider bridge={bridge}>
          <m.JotxEditor
            documentId={documentId}
            documentType={documentType}
            tiptapDoc={tiptapDoc}
            onChange={onChange}
            ribbonExpanded={ribbonExpanded}
            editable={editable}
          />
        </m.BridgeProvider>
      )
    }
  }))
)

// Initialize registry + parser once
const registry = new BlockRegistry()
registerStandardBlocks(registry)
const parser = new Parser({ registry })
const serializer = new Serializer()
const tiptapAdapter = new TiptapAdapter()

type SaveStatus = 'saved' | 'saving' | 'unsaved' | null

interface Props {
  filePath: string
  fileName: string
}

// Web bridge — no-op for VSCode-specific features
const webBridge = {
  log: (msg: string) => console.info('[jotx]', msg),
  error: (msg: string) => console.error('[jotx]', msg),
  openFile: () => {},
  showMessage: (msg: string) => console.info('[jotx]', msg),
  navigateToSymbol: () => {},
  saveState: () => {},
  getState: () => undefined,
  onMessage: () => () => {},
}

export function JotxFileEditor({ filePath, fileName }: Props) {
  const [tiptapDoc, setTiptapDoc] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docMetaRef = useRef<{ id: string; type: string; metadata: Record<string, string> } | null>(null)
  const localAgentUrl = useWorkspaceStore(s => s.localHermesUrl)
  const activeWorkspacePath = useWorkspaceStore(s => s.activeWorkspacePath)

  // Load file → parse → convert to Tiptap JSON
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
          const data = await res.json() as { content: string }
          rawContent = data.content
        }

        // If empty file, use a minimal template
        const content = rawContent?.trim() || `hdef jotx ${fileName.replace(/\.\w+$/, '')}\n  title "Untitled"\n\n  def paragraph p1\n    text "Start writing here..."`

        const result = parser.parse(content)
        if (result.errors?.length) {
          console.warn('[jotx] Parse warnings:', result.errors)
        }

        const doc = result.document
        docMetaRef.current = { id: doc.id, type: doc.type, metadata: doc.metadata ?? {} }

        // Convert blocks to Tiptap JSON
        const tiptapNodes = (doc.blocks ?? []).map((b: any) => tiptapAdapter.blockToTiptap(b))
        const tiptapDocument = { type: 'doc', content: tiptapNodes }

        if (!cancelled) {
          setTiptapDoc(tiptapDocument)
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
    return () => { cancelled = true }
  }, [filePath])

  // Handle changes from the editor — auto-save with debounce
  const handleChange = (tiptapJson: string) => {
    setSaveStatus('unsaved')
    if (pendingSave.current) clearTimeout(pendingSave.current)

    pendingSave.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        // Convert Tiptap JSON back to jotx text
        const tiptapDocument = JSON.parse(tiptapJson)
        const blocks = tiptapAdapter.tiptapToBlocks(tiptapDocument)
        const meta = docMetaRef.current

        // Rebuild AST for serialization
        const ast = {
          document: {
            id: meta?.id ?? 'untitled',
            type: meta?.type ?? 'jotx',
            metadata: meta?.metadata ?? {},
            blocks,
          },
        }

        const jotText = serializer.serialize(ast as any)

        if (localAgentUrl && activeWorkspacePath) {
          await localWriteFile(localAgentUrl, activeWorkspacePath, filePath, jotText)
        } else {
          await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'write', path: filePath, content: jotText }),
          })
        }

        setSaveStatus('saved')
      } catch (e) {
        console.error('[jotx] Save failed:', e)
        setSaveStatus('unsaved')
      }
    }, 1500)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--theme-accent)' }}>jotx</span>
        </div>
        <div className="w-px h-5 shrink-0" style={{ background: 'var(--theme-border)' }} />
        <span className="font-mono text-xs font-medium" style={{ color: 'var(--theme-text)' }}>{fileName}</span>
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && '✓ Saved'}
          {saveStatus === 'unsaved' && '● Unsaved'}
        </span>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center flex-1 gap-3" style={{ color: 'var(--theme-muted)' }}>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <span className="text-sm">Loading {fileName}…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center flex-1">
          <div className="text-sm px-4 py-3 rounded-xl" style={{ background: '#3f0f0f', color: '#f87171' }}>
            {error}
          </div>
        </div>
      )}

      {/* Editor */}
      {tiptapDoc && !loading && !error && (
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--theme-bg)' }}>
          <Suspense fallback={<div className="flex items-center justify-center py-20 gap-3" style={{ color: 'var(--theme-muted)' }}><div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />Loading editor...</div>}>
            <JotxEditorLazy
              documentId={filePath}
              documentType="page"
              tiptapDoc={tiptapDoc}
              onChange={handleChange}
              ribbonExpanded={true}
              editable={true}
              bridge={webBridge}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
