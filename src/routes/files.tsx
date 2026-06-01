import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { CodeMirrorEditor } from '@/components/code-editor/CodeMirrorEditor'
import { brand } from '@/brand'
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { FileExplorerSidebar, type FileEntry } from '@/components/file-explorer'
import { resolveTheme, useSettings } from '@/hooks/use-settings'
import { JotxFileEditor } from '@/components/jotx-editor/JotxFileEditor'
import {
  SylangFileEditor,
  isSylangFile,
} from '@/components/sylang-editor/SylangFileEditor'
import { SpecViewer } from '@/components/spec-dash/SpecViewer'
import { DashViewer } from '@/components/spec-dash/DashViewer'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { SessionTimer } from '@/components/session-timer'
import { GitDiffView, type GitDiffSelection } from '@/components/git-panel'

function isJotxFile(name: string): boolean {
  return name.endsWith('.jot')
}

// .spec / .dash use the @sylang/spec-dash server pipeline — text →
// parser → renderer → HTML string → sandboxed iframe. They aren't
// edited inline (yet); the viewer is read-only HTML for now.
function isSpecFile(name: string): boolean {
  return name.endsWith('.spec')
}
function isDashFile(name: string): boolean {
  return name.endsWith('.dash')
}

const INITIAL_EDITOR_VALUE = `// Files workspace
// Use the file tree on the left to browse and manage project files.
// "Insert as reference" actions appear here for quick context snippets.

function note() {
  return 'Ready to explore files.'
}
`

export const Route = createFileRoute('/files')({
  validateSearch: (search: Record<string, unknown>) => ({
    path: typeof search.path === 'string' ? search.path : '',
  }),
  component: FilesRoute,
  errorComponent: function FilesError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-primary-50">
        <h2 className="text-xl font-semibold text-primary-900 mb-3">
          Failed to Load Files
        </h2>
        <p className="text-sm text-primary-600 mb-4 max-w-md">
          {error instanceof Error
            ? error.message
            : 'An unexpected error occurred'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Reload Page
        </button>
      </div>
    )
  },
  pendingComponent: function FilesPending() {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-accent-500 border-r-transparent mb-3" />
          <p className="text-sm text-primary-500">Loading file explorer...</p>
        </div>
      </div>
    )
  },
})

function guessLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown',
    '.css': 'css', '.html': 'html',
    '.py': 'python', '.rs': 'rust',
    '.go': 'go', '.yaml': 'yaml', '.yml': 'yaml',
    '.sh': 'shell', '.c': 'c', '.cpp': 'cpp',
  }
  return map[ext] ?? 'plaintext'
}

type SelectedFile = {
  path: string
  name: string
  ext: string
  /** When opened via click-to-id, the symbol the editor should scroll to + highlight. */
  focusSymbolId?: string
}

function FilesRoute() {
  usePageTitle('Files')
  const { settings } = useSettings()
  const { path: initialPath } = Route.useSearch()
  const [isMobile, setIsMobile] = useState(false)
  const [fileExplorerCollapsed, setFileExplorerCollapsed] = useState(false)
  const [editorValue, setEditorValue] = useState(INITIAL_EDITOR_VALUE)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<GitDiffSelection | null>(null)
  // Inline view active on the home page (when no file is selected). Clicking
  // a Quick Action card on WorkspaceHome sets this to 'coverage' /
  // 'traceability' / 'fmea' / etc. and InlineViewHome renders the workbench
  // in place of the home cards. Selecting a file from the sidebar
  // implicitly returns to the per-file editor (the conditional below sees
  // selectedFile first).
  const [homeActiveView, setHomeActiveView] = useState<string | null>(null)
  // Save-state tracking. ``loadedContent`` is what we last read from disk
  // for ``loadedPath``; comparing against ``editorValue`` gives us "dirty"
  // without needing a separate dirty flag the user has to remember to set.
  const [loadedContent, setLoadedContent] = useState('')
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const resolvedTheme = resolveTheme(settings.theme)
  const setActiveWorkspacePath = useWorkspaceStore((s) => s.setActiveWorkspacePath)

  useEffect(() => {
    if (initialPath) {
      setActiveWorkspacePath(initialPath)
    }
  }, [initialPath, setActiveWorkspacePath])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!isMobile) return
    setFileExplorerCollapsed(true)
  }, [isMobile])

  const handleInsertReference = useCallback(function handleInsertReference(
    reference: string,
  ) {
    setEditorValue((prev) => `${prev}\n${reference}\n`)
  }, [])

  const handleOpenFile = useCallback(async (entry: FileEntry) => {
    const ext = entry.name.includes('.')
      ? entry.name.slice(entry.name.lastIndexOf('.'))
      : ''
    setSelectedDiff(null)
    setSelectedFile({ path: entry.path, name: entry.name, ext })
    setSavedOk(false)
    // Jotx, Sylang, Spec, and Dash viewers do their own file I/O;
    // CodeMirror branch is the only one that needs the host to pre-load
    // the content into editorValue.
    if (
      !isJotxFile(entry.name) &&
      !isSylangFile(entry.name) &&
      !isSpecFile(entry.name) &&
      !isDashFile(entry.name)
    ) {
      try {
        const res = await fetch(`/api/files?action=read&path=${encodeURIComponent(entry.path)}`)
        if (res.ok) {
          const { content } = await res.json() as { content: string }
          setEditorValue(content)
          setLoadedContent(content)
          setLoadedPath(entry.path)
        }
      } catch {
        // keep existing editor value
      }
    }
  }, [])

  const handleOpenDiff = useCallback((selection: GitDiffSelection) => {
    setSelectedFile(null)
    setSelectedDiff(selection)
  }, [])

  // ──────────────────────────────────────────────────────────────────────────
  // Save flow
  //
  // ``dirty`` is computed, not stored — true when the editor's value diverges
  // from what was last loaded from disk for the SAME path. The path check
  // matters because handleOpenFile sets selectedFile + editorValue + loaded*
  // in sequence; without it we'd briefly compute dirty=true during a
  // file-switch and the auto-save effect would race the load.
  // ──────────────────────────────────────────────────────────────────────────

  const dirty =
    !!selectedFile &&
    loadedPath === selectedFile.path &&
    editorValue !== loadedContent

  const commitSave = useCallback(async (path: string, value: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'write', path, content: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLoadedContent(value)
      setLoadedPath(path)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } catch {
      // Silent failure for now; user can retry via the Save button.
      // TODO: surface via toast when toast system lands.
    } finally {
      setSaving(false)
    }
  }, [])

  const handleSave = useCallback(() => {
    if (!selectedFile || !dirty) return
    void commitSave(selectedFile.path, editorValue)
  }, [selectedFile, dirty, editorValue, commitSave])

  // Auto-save: 1.5s after the user stops typing. Cancels on next edit, file
  // switch, or while a save is in flight.
  useEffect(() => {
    if (!selectedFile || !dirty || saving) return
    const handle = setTimeout(() => {
      void commitSave(selectedFile.path, editorValue)
    }, 1500)
    return () => clearTimeout(handle)
  }, [selectedFile, dirty, saving, editorValue, commitSave])

  return (
    <div className="h-full min-h-0 overflow-hidden bg-surface text-primary-900">
      <div className="flex h-full min-h-0 overflow-hidden">
        <FileExplorerSidebar
          collapsed={fileExplorerCollapsed}
          onToggle={function onToggleFileExplorer() {
            setFileExplorerCollapsed((prev) => !prev)
          }}
          onInsertReference={handleInsertReference}
          onOpenFile={handleOpenFile}
          onOpenDiff={handleOpenDiff}
          selectedPath={selectedFile?.path ?? ''}
          initialPath={initialPath || ''}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Persistent session-timer bar — always at the top of the
              editor area regardless of which editor renders below
              (Sylang iframe, Jotx, CodeMirror, GitDiffView, or the
              WorkspaceHome view). Renders null in local agent mode. */}
          <div
            className="flex items-center gap-3 px-4 py-1 border-b shrink-0"
            style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
          >
            {/* Click "Sylang Studio" to drop both the selected file and
                any active inline view — returns the user to
                WorkspaceHome from anywhere in the editor pane. */}
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null)
                setHomeActiveView(null)
              }}
              className="text-[11px] font-semibold tracking-tight bg-transparent border-0 p-0 hover:underline cursor-pointer"
              style={{ color: 'var(--theme-accent)' }}
              title="Back to workspace home"
            >
              {brand.appTitle}
            </button>
            <div className="flex-1" />
            <SessionTimer />
          </div>
          {selectedDiff ? (
            <GitDiffView
              selection={selectedDiff}
              onClose={() => setSelectedDiff(null)}
            />
          ) : selectedFile && isJotxFile(selectedFile.name) ? (
            <JotxFileEditor
              filePath={selectedFile.path}
              fileName={selectedFile.name}
            />
          ) : selectedFile && isSpecFile(selectedFile.name) ? (
            /* .spec / .dash MUST be checked before isSylangFile — the
               sylang-core registry classifies them as Sylang file types
               (`SYLANG_FILE_EXTENSIONS` includes `.spec` and `.dash`),
               so isSylangFile() returns true for both. Without these two
               branches landing first, .spec and .dash files would open
               in the TipTap Sylang editor instead of their HTML renderers. */
            <SpecViewer
              filePath={selectedFile.path}
              fileName={selectedFile.name}
              onNavigate={(path) => {
                /* Embedded `View Diagram` buttons inside a .spec ask
                   the host to open the referenced .blk / .ucd / etc.
                   Same shape SylangFileEditor uses for click-to-id
                   nav — set selectedFile, don't change the URL. */
                const name = path.split('/').pop() ?? path
                const ext = name.includes('.')
                  ? name.slice(name.lastIndexOf('.'))
                  : ''
                setSelectedFile({ path, name, ext })
              }}
            />
          ) : selectedFile && isDashFile(selectedFile.name) ? (
            <DashViewer
              filePath={selectedFile.path}
              fileName={selectedFile.name}
            />
          ) : selectedFile && isSylangFile(selectedFile.name) ? (
            <SylangFileEditor
              filePath={selectedFile.path}
              fileName={selectedFile.name}
              focusSymbolId={selectedFile.focusSymbolId}
              onNavigate={(path, symbolId) => {
                const name = path.split('/').pop() ?? path
                const ext = name.includes('.')
                  ? name.slice(name.lastIndexOf('.'))
                  : ''
                setSelectedFile({ path, name, ext, focusSymbolId: symbolId })
              }}
            />
          ) : selectedFile ? (
            <>
              <div
                className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0 text-xs"
                style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
              >
                <span className="font-mono font-medium" style={{ color: 'var(--theme-text)' }}>
                  {selectedFile.name}
                </span>
                <span style={{ color: 'var(--theme-muted)' }}>
                  {guessLanguage(selectedFile.ext)}
                </span>
                {/* Save state — auto-save fires 1.5s after edits stop. */}
                <span
                  className="text-[11px] font-medium tabular-nums"
                  style={{
                    color: saving
                      ? 'var(--theme-muted)'
                      : savedOk
                        ? '#10b981'
                        : dirty
                          ? '#f59e0b'
                          : 'transparent',
                  }}
                  aria-live="polite"
                >
                  {saving
                    ? 'Saving…'
                    : savedOk
                      ? '✓ Saved'
                      : dirty
                        ? 'Unsaved'
                        : '·'}
                </span>
                <div className="flex-1" />
                {/* SessionTimer lives in the persistent top bar above —
                    no need to duplicate it inside the file-open header. */}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
                  style={{
                    background: dirty && !saving ? 'var(--theme-accent)' : 'transparent',
                    color: dirty && !saving ? '#fff' : 'var(--theme-muted)',
                    border: '1px solid var(--theme-border)',
                  }}
                  title="Save now (auto-saves after 1.5s anyway)"
                >
                  Save
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <CodeMirrorEditor
                  value={editorValue}
                  language={selectedFile.ext}
                  onChange={setEditorValue}
                />
              </div>
            </>
          ) : homeActiveView ? (
            /* Home-page Quick Action active — render the inline workbench
               in place of the cards with a "Back to Home" affordance. */
            <InlineViewHome
              view={homeActiveView}
              workspace={initialPath}
              onClose={() => setHomeActiveView(null)}
              onNavigate={(path, symbolId) => {
                // Coverage / traceability identifier click → open the file
                // in the regular editor flow. Clear the home view so the
                // per-file editor takes over.
                const name = path.split('/').pop() ?? path
                const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
                setSelectedFile({ path, name, ext, focusSymbolId: symbolId })
                setHomeActiveView(null)
              }}
            />
          ) : (
            /* Default home: hero + Quick Actions + file-type guide. */
            <WorkspaceHome workspacePath={initialPath} onViewChange={setHomeActiveView} />
          )}
        </main>
      </div>
    </div>
  )
}

// ─── Workspace Home ─────────────────────────────────────────────────────────
//
// The landing surface inside the editor pane when no file is selected.
// Ported from sylang-hermes' files.tsx so the Sylang analysis features
// (Coverage / Traceability / FMEA / ASPICE) get first-class entry points
// on the home page, not just from the NestMenuBar.

// First-class file types in Sylang. Order matches sylang-hermes for
// visual continuity; extensions and descriptions are the same.
const FILE_TYPE_INFO = [
  { ext: '.req', label: 'Requirements', icon: '📋', desc: 'System & software requirements with traceability' },
  { ext: '.fun', label: 'Functions', icon: '⚙️', desc: 'Functional decomposition & function networks' },
  { ext: '.blk', label: 'Blocks', icon: '🧱', desc: 'Internal block diagrams & architecture' },
  { ext: '.fml', label: 'Feature Models', icon: '🌳', desc: 'Product line features & variability' },
  { ext: '.vml', label: 'Variants', icon: '🔀', desc: 'Variant configurations & selections' },
  { ext: '.flr', label: 'Failure Modes', icon: '⚠️', desc: 'FMEA failure analysis (AIAG/VDA)' },
  { ext: '.fta', label: 'Fault Trees', icon: '🌲', desc: 'Fault tree analysis (ISO 26262)' },
  { ext: '.tst', label: 'Test Cases', icon: '✅', desc: 'Verification & validation test specs' },
  { ext: '.haz', label: 'Hazards', icon: '🔴', desc: 'Hazard analysis & risk assessment' },
  { ext: '.ifc', label: 'Interfaces', icon: '🔌', desc: 'Signals, operations & data types' },
  { ext: '.smd', label: 'State Machines', icon: '🔄', desc: 'State machine diagrams' },
  { ext: '.ucd', label: 'Use Cases', icon: '👤', desc: 'Use case diagrams & actor mapping' },
]

// The viewKey strings match `nest-menu-bar.tsx`'s VIEW_MAP and the
// `InlineView` switch in `SylangFileEditor.tsx`, so a single dispatch
// table powers both the home Quick Actions and the per-file menu.
const QUICK_ACTIONS = [
  { label: 'Coverage Analysis', viewKey: 'coverage', icon: '📊', desc: 'Analyze identifier relationships and coverage' },
  { label: 'Traceability Graph', viewKey: 'traceability', icon: '🔗', desc: 'Interactive cross-file relationship graph' },
  { label: 'FMEA AIAG/VDA', viewKey: 'fmea', icon: '⚠️', desc: 'Failure mode and effects analysis' },
  { label: 'ASPICE Workbench', viewKey: 'aspice', icon: '🏗️', desc: 'Automotive SPICE process assessment' },
]

function WorkspaceHome({
  workspacePath,
  onViewChange,
}: {
  workspacePath: string
  onViewChange?: (view: string) => void
}) {
  const segments = workspacePath.split('/').filter(Boolean)
  const repoName = segments.length >= 3 ? segments[2] : (segments.pop() ?? 'Workspace')

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--theme-bg)' }}>
      <div className="max-w-4xl mx-auto px-8 py-10">
        {/* Hero */}
        <div className="flex items-center gap-4 mb-10">
          <div
            className="h-14 w-14 rounded-2xl shadow-lg flex items-center justify-center text-3xl"
            style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
          >
            🛰️
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--theme-text)' }}>
              {repoName}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--theme-muted)' }}>
              {brand.showMbseTools ? 'Model-Based Systems Engineering Workspace' : 'Workspace'}
            </p>
          </div>
        </div>

        {/* MBSE tools (Quick Actions + file-type guide + standards callout) —
            Sylang only; hidden in Hermes via brand.showMbseTools. */}
        {brand.showMbseTools && (
        <>
        {/* Quick Actions — Coverage / Traceability / FMEA / ASPICE. */}
        <div className="mb-10">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--theme-muted)' }}
          >
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.viewKey}
                onClick={() => onViewChange?.(action.viewKey)}
                className="rounded-xl px-4 py-4 text-left transition-all hover:scale-[1.02]"
                style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
              >
                <div className="text-2xl mb-2">{action.icon}</div>
                <div className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
                  {action.label}
                </div>
                <div className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--theme-muted)' }}>
                  {action.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* File-type guide — what each extension means. Purely
            informational; clicking doesn't filter. */}
        <div className="mb-10">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--theme-muted)' }}
          >
            Sylang File Types
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {FILE_TYPE_INFO.map((ft) => (
              <div
                key={ft.ext}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
              >
                <span className="text-lg shrink-0">{ft.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--theme-text)' }}>
                      {ft.label}
                    </span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--theme-card2)', color: 'var(--theme-accent)' }}
                    >
                      {ft.ext}
                    </span>
                  </div>
                  <div
                    className="text-[11px] mt-0.5 leading-snug"
                    style={{ color: 'var(--theme-muted)' }}
                  >
                    {ft.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Standards callout — kept short. */}
        <div
          className="rounded-xl px-5 py-4"
          style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg">🛡️</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
              Built for Safety-Critical Engineering
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
            Sylang supports ISO 26262 functional safety, Automotive SPICE process compliance,
            FMEA AIAG/VDA failure analysis, and product line engineering (150% model). Select a
            file from the sidebar to start editing, or use the quick actions above to analyze
            your project.
          </p>
        </div>
        </>
        )}
      </div>
    </div>
  )
}

// ─── InlineViewHome ─────────────────────────────────────────────────────────
//
// Wrapper that renders one of the inline analysis views (coverage,
// traceability, fmea, …) on the home page, with a "← Back to Home"
// affordance to return to the Quick Actions. The actual workbench
// components are the same ones SylangFileEditor uses — lazy-loaded so
// the home bundle stays small.

const HomeCoverageView = lazy(() => import('@/components/sylang-editor/inline-views/coverage-view'))
const HomeTraceabilityView = lazy(() => import('@/components/sylang-editor/inline-views/traceability-view'))
const HomeFmeaView = lazy(() => import('@/components/sylang-editor/inline-views/fmea-view'))

function InlineViewHome({
  view,
  workspace,
  onClose,
  onNavigate,
}: {
  view: string
  workspace: string
  onClose: () => void
  onNavigate?: (path: string, symbolId?: string) => void
}) {
  // Strip anything beyond `userId/owner/repo` — workspace prefix is what
  // each /api/sylang/* route expects.
  const ws = workspace.split('/').filter(Boolean).slice(0, 3).join('/')

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-1 shrink-0"
        style={{ borderBottom: '1px solid var(--theme-border)' }}
      >
        <button
          onClick={onClose}
          className="text-xs px-2 py-0.5 rounded font-medium hover:bg-white/10"
          style={{ color: 'var(--theme-accent)' }}
        >
          ← Back to Home
        </button>
      </div>
      <div
        className={`flex-1 min-h-0 ${view === 'traceability' ? 'overflow-hidden' : 'overflow-y-auto'}`}
        style={{ background: 'var(--theme-bg)' }}
      >
        <Suspense
          fallback={
            <div
              className="flex items-center justify-center py-20 gap-3"
              style={{ color: 'var(--theme-muted)' }}
            >
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
              Loading…
            </div>
          }
        >
          {view === 'coverage' && <HomeCoverageView workspace={ws} onNavigate={onNavigate} />}
          {view === 'traceability' && <HomeTraceabilityView workspace={ws} />}
          {view === 'fmea' && <HomeFmeaView workspace={ws} />}
          {(view === 'aspice' || view === 'iso26262') && (
            <div
              className="flex flex-col items-center justify-center gap-3 py-20 text-center"
              style={{ color: 'var(--theme-muted)' }}
            >
              <div className="text-base font-medium" style={{ color: 'var(--theme-text)' }}>
                {view} — coming soon
              </div>
              <div className="text-xs max-w-sm">
                The analyzer for this view hasn't landed in <code>@sylang-core</code> yet.
              </div>
            </div>
          )}
        </Suspense>
      </div>
    </div>
  )
}
