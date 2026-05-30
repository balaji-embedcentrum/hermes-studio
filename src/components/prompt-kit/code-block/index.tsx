import { useEffect, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { createHighlighter } from 'shiki'
import { formatLanguageName, normalizeLanguage, resolveLanguage } from './utils'
import type { BundledLanguage, Highlighter } from 'shiki'
import { useResolvedTheme } from '@/hooks/use-chat-settings'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

type CodeBlockProps = {
  content: string
  ariaLabel?: string
  language?: string
  className?: string
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['vitesse-light', 'vitesse-dark'],
      langs: ['text'],
    })
  }
  return highlighterPromise
}

export function CodeBlock({
  content,
  ariaLabel,
  language = 'text',
  className,
}: CodeBlockProps) {
  const resolvedTheme = useResolvedTheme()
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [resolvedLanguage, setResolvedLanguage] = useState('text')
  const [themeBg, setThemeBg] = useState<string | undefined>()

  const normalizedLanguage = normalizeLanguage(language || 'text')
  const themeName = resolvedTheme === 'dark' ? 'vitesse-dark' : 'vitesse-light'
  const lineCount = useMemo(
    () => Math.max(1, content.split('\n').length),
    [content],
  )
  const isSingleLine = lineCount === 1
  const showLineNumbers = !isSingleLine

  useEffect(() => {
    let active = true
    getHighlighter()
      .then(async (highlighter) => {
        let lang = resolveLanguage(normalizedLanguage)
        if (lang !== 'text') {
          try {
            await highlighter.loadLanguage(lang as BundledLanguage)
          } catch {
            lang = 'text'
          }
        }
        const highlighted = highlighter.codeToHtml(content, {
          lang: lang as BundledLanguage,
          theme: themeName,
        })
        if (active) {
          setResolvedLanguage(lang)
          setHtml(highlighted)
          setThemeBg(highlighter.getTheme(themeName).bg)
        }
      })
      .catch(() => {
        if (active) setHtml(null)
      })
    return () => {
      active = false
    }
  }, [content, normalizedLanguage, themeName])

  async function handleCopy() {
    try {
      await writeTextToClipboard(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const displayLanguage = formatLanguageName(resolvedLanguage)

  return (
    <div
      className={cn(
        'group relative my-3 min-w-0 overflow-hidden rounded-lg border border-primary-200/80 shadow-sm',
        className,
      )}
      style={themeBg ? { backgroundColor: themeBg } : undefined}
    >
      <div className="flex items-center justify-between border-b border-primary-200/60 px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-primary-500 uppercase">
          {displayLanguage}
        </span>
        <button
          type="button"
          aria-label={ariaLabel ?? (copied ? 'Copied' : 'Copy code')}
          onClick={() => {
            handleCopy().catch(() => {})
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
            'text-primary-500 hover:bg-primary-100/70 hover:text-primary-900',
            copied && 'text-primary-700',
          )}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={14}
            strokeWidth={1.75}
          />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="flex min-w-0 overflow-x-auto">
        {showLineNumbers ? (
          <ol
            aria-hidden="true"
            className="sticky left-0 z-10 m-0 flex-none border-r border-primary-200/40 py-3 pl-3 pr-3 text-right text-xs leading-6 text-primary-400/80 tabular-nums select-none"
            style={themeBg ? { backgroundColor: themeBg } : undefined}
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <li key={`line-${index + 1}`} className="list-none">
                {index + 1}
              </li>
            ))}
          </ol>
        ) : null}
        <div className="min-w-0 flex-1">
          {html ? (
            <div
              className={cn(
                'text-sm text-primary-900 [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:overflow-visible [&>pre]:leading-6',
                isSingleLine
                  ? '[&>pre]:whitespace-pre [&>pre]:px-3 [&>pre]:py-2'
                  : '[&>pre]:px-3 [&>pre]:py-3',
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre
              className={cn(
                'm-0 bg-transparent text-sm leading-6 text-primary-900',
                isSingleLine ? 'whitespace-pre px-3 py-2' : 'px-3 py-3',
              )}
            >
              <code>{content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
