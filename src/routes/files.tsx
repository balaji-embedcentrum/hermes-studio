import { useCallback, useEffect, useState } from 'react'
import { CodeMirrorEditor } from '@/components/code-editor/CodeMirrorEditor'
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { FileExplorerSidebar, type FileEntry } from '@/components/file-explorer'
import { resolveTheme, useSettings } from '@/hooks/use-settings'
import { JotxFileEditor } from '@/components/jotx-editor/JotxFileEditor'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { SessionTimer } from '@/components/session-timer'
import { GitDiffView, type GitDiffSelection } from '@/components/git-panel'

function isJotxFile(name: string): boolean {
  return name.endsWith('.jot')
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
    if (!isJotxFile(entry.name)) {
      try {
        const res = await fetch(`/api/files?action=read&path=${encodeURIComponent(entry.path)}`)
        if (res.ok) {
          const { content } = await res.json() as { content: string }
          setEditorValue(content)
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
              </div>
              <div className="min-h-0 flex-1">
                <CodeMirrorEditor
                  value={editorValue}
                  language={selectedFile.ext}
                  onChange={setEditorValue}
                />
              </div>
            </>
          ) : (
            <>
              <div
                className="flex items-center gap-3 px-4 py-1.5 border-b shrink-0"
                style={{ background: 'var(--theme-sidebar)', borderColor: 'var(--theme-border)' }}
              >
                <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--theme-accent)' }}>
                  Hermes Studio
                </span>
                <div className="flex-1" />
                <SessionTimer />
              </div>
              <WorkspaceHome workspacePath={initialPath} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function WorkspaceHome({ workspacePath }: { workspacePath: string }) {
  const segments = workspacePath.split('/').filter(Boolean)
  const repoName = segments.length >= 3 ? segments[2] : segments.pop() ?? 'Workspace'

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--theme-bg)' }}>
      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--theme-text)' }}>
            {repoName}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--theme-muted)' }}>
            Select a file from the sidebar to start editing.
          </p>
        </div>
        <div className="rounded-xl px-5 py-4" style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)' }}>
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Hermes Studio</div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
            An AI agent workspace with chat, files, terminal, memory, and skills.
            Browse and edit any text file via the file explorer; richer editors
            load automatically for supported formats (e.g. .jot).
          </p>
        </div>
      </div>
    </div>
  )
}
