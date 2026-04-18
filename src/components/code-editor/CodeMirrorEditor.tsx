/**
 * CodeMirror 6 editor — lightweight, no textarea leak, clean rendering.
 * Supports: JS/TS, Python, JSON, CSS, HTML, Rust, Go, C/C++, YAML, Markdown, Shell
 */
import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'

function getLanguageExtension(ext: string) {
  switch (ext) {
    case '.ts': case '.tsx': return javascript({ jsx: true, typescript: true })
    case '.js': case '.jsx': return javascript({ jsx: true })
    case '.py': return python()
    case '.json': return json()
    case '.css': case '.scss': case '.less': return css()
    case '.html': case '.htm': case '.xml': case '.svg': return html()
    case '.rs': return rust()
    case '.c': case '.cpp': case '.h': case '.hpp': return cpp()
    case '.go': return go()
    case '.yaml': case '.yml': return yaml()
    case '.md': return markdown()
    case '.sh': case '.bash': case '.zsh': return javascript() // shell fallback
    default: return []
  }
}

interface Props {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function CodeMirrorEditor({ value, language, onChange, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const langExt = getLanguageExtension(language)

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        ...(Array.isArray(langExt) ? langExt : [langExt]),
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString())
          }
        }),
        // Match our dark theme
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          },
          '.cm-gutters': {
            backgroundColor: '#0e1117',
            borderRight: '1px solid rgba(255,255,255,0.08)',
          },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [language]) // Recreate when language changes

  // Update content when value prop changes (without recreating editor)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      })
    }
  }, [value])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
