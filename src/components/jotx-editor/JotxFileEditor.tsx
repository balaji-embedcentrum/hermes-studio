/**
 * JotxFileEditor — renders .jot files using @sylang/jot-editor.
 *
 * History: this used to import @jotx-labs/editor directly and drove its
 * tiptap document via `useEffect + setTiptapDoc(...)`. That triggers a
 * known layout-effect race inside @jotx-labs/editor's BlockMenu — every
 * setTiptapDoc looks like an editor recreation, but the new TipTap view
 * isn't mounted yet, so the next render throws
 * "[tiptap error]: The editor view is not available. Cannot access
 *  view['dom']. The editor may not be mounted yet."
 *
 * @sylang/jot-editor wraps @jotx-labs/editor with the right lifecycle:
 *   • parse the raw text *once* per mount via `useState` lazy initializer
 *   • the TipTap editor owns content from mount onwards
 *   • the host swaps files by passing a different `key` so React remounts
 *
 * This component now is just: fetch the file, hand the text to
 * <JotxEditor>, and debounce-save what it returns.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { JotxEditor } from '@sylang/jot-editor'
import '@sylang/jot-editor/styles.css'
// Full 6354-line Notion-style styling (tables, headings, lists, callouts,
// etc.) lifted from sylang2.1/src/jotx — kept host-local because the npm
// `@sylang/jot-editor` only ships a minimal layout stub. We should fold
// this back into the package and republish, but the cosmetic version
// bump is a separate task; for now the host imports it directly.
import './jotx-editor.css'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { localReadFile, localWriteFile } from '@/lib/local-file-ops'

type SaveStatus = 'saved' | 'saving' | 'unsaved' | null

interface Props {
  filePath: string
  fileName: string
}

export function JotxFileEditor({ filePath, fileName }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localAgentUrl = useWorkspaceStore((s) => s.localHermesUrl)
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath)

  // Fetch the raw .jot text. Re-runs when filePath changes; the wrapper
  // component below is keyed on filePath too, so it remounts on file
  // change rather than mutating state in place.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)

    async function load() {
      try {
        let raw: string
        if (localAgentUrl && activeWorkspacePath) {
          const result = await localReadFile(localAgentUrl, activeWorkspacePath, filePath)
          raw = result.content
        } else {
          const res = await fetch(`/api/files?action=read&path=${encodeURIComponent(filePath)}`)
          if (!res.ok) throw new Error(`Cannot read file: HTTP ${res.status}`)
          const data = (await res.json()) as { content: string }
          raw = data.content
        }
        if (!cancelled) {
          setContent(raw ?? '')
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
  }, [filePath, localAgentUrl, activeWorkspacePath])

  // Debounced save — @sylang/jot-editor hands us the already-serialized
  // .jot text, so we just write it back.
  const handleChange = useCallback(
    (text: string) => {
      setSaveStatus('unsaved')
      if (pendingSave.current) clearTimeout(pendingSave.current)
      pendingSave.current = setTimeout(async () => {
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
          setSaveStatus('saved')
        } catch (e) {
          console.error('[jotx] Save failed:', e)
          setSaveStatus('unsaved')
        }
      }, 1500)
    },
    [filePath, localAgentUrl, activeWorkspacePath],
  )

  return (
    <div className="jotx-host flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0"
        style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--theme-accent)' }}>
            jotx
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

      {/* Editor — `key={filePath}` ensures React remounts on file change,
          which is exactly what @sylang/jot-editor's wrapper expects. */}
      {content !== null && !loading && !error && (
        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ background: 'var(--theme-bg)' }}
        >
          <JotxEditor
            key={filePath}
            value={content}
            fileName={fileName}
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  )
}
