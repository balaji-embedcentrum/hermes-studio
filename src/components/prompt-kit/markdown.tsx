import { marked } from 'marked'
import { memo, useId, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code-block'
import type { Components } from 'react-markdown'
import { cn } from '@/lib/utils'

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

/**
 * Defensive cleanup for common malformations produced by chat agents that
 * emit close-fence directly against the preceding block, or open-fence with
 * no preceding blank line. Without the blank line, marked.lexer treats the
 * fence as continuation of the previous block (a table row continues, a
 * paragraph absorbs the fence as literal), and the entire code block ends
 * up rendered as stacked plain-text lines with no <pre> / Shiki / copy
 * button. We don't touch fence content — only the surrounding whitespace.
 */
function normalizeMarkdown(markdown: string): string {
  let normalized = markdown
  // 1. Fence glued to the end of a previous line (no newline at all between
  //    them): split with a hard blank line. Most common is a table row
  //    ending in `|` immediately followed by ```lang on the same line.
  normalized = normalized.replace(/([^\n`])(`{3,})/g, '$1\n\n$2')
  // 2. Fence on its own line but with no blank line above. Insert one so
  //    marked.lexer treats it as a standalone block.
  normalized = normalized.replace(/([^\n])\n(`{3,})/g, '$1\n\n$2')
  // 3. Same on the closing side: fence followed by non-blank content.
  normalized = normalized.replace(/(`{3,}[^\n]*)\n([^\n])/g, (full, fence, next) => {
    // Don't add a blank line inside a fence body — only after the marker
    // line. The fence marker line is `^\`{3,}[lang]?$` (opening) or
    // `^\`{3,}$` (closing). We treat any matched fence line as a marker.
    if (/^`{3,}\w*$/.test(fence.trimStart())) {
      return `${fence}\n\n${next}`
    }
    return full
  })
  return normalized
}

function parseMarkdownIntoBlocks(markdown: string): Array<string> {
  const cleaned = normalizeMarkdown(markdown)
  const tokens = marked.lexer(cleaned)
  return tokens.map((token) => token.raw)
}

function extractLanguage(className?: string): string {
  if (!className) return 'text'
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : 'text'
}

function textFromNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map((item: React.ReactNode) => textFromNode(item)).join('')
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props: { children?: React.ReactNode } }
    return textFromNode(element.props.children)
  }
  return ''
}

function slugifyHeading(children: React.ReactNode): string {
  const raw = textFromNode(children)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
  return raw.length > 0 ? raw : 'section'
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children }) {
    const isInline = !className?.includes('language-')

    if (isInline) {
      return (
        <code className="rounded bg-primary-100/70 px-1 py-0.5 text-[0.88em] font-mono text-primary-900">
          {children}
        </code>
      )
    }

    const language = extractLanguage(className)
    return (
      <CodeBlock
        content={String(children ?? '').replace(/\n$/, '')}
        language={language}
      />
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  h1: function H1Component({ children }) {
    return (
      <h1 className="mt-5 mb-2 text-2xl leading-tight font-semibold text-primary-950 text-balance first:mt-0">
        {children}
      </h1>
    )
  },
  h2: function H2Component({ children }) {
    const id = slugifyHeading(children)
    return (
      <h2
        id={id}
        className="mt-5 mb-2 text-xl leading-tight font-semibold text-primary-950 text-balance first:mt-0"
      >
        <a
          href={`#${id}`}
          className="group/heading inline-flex items-center gap-1 no-underline"
        >
          <span>{children}</span>
          <span
            aria-hidden="true"
            className="text-primary-400 opacity-0 transition-opacity group-hover/heading:opacity-100"
          >
            #
          </span>
        </a>
      </h2>
    )
  },
  h3: function H3Component({ children }) {
    const id = slugifyHeading(children)
    return (
      <h3
        id={id}
        className="mt-4 mb-1.5 text-lg leading-tight font-semibold text-primary-950 text-balance first:mt-0"
      >
        <a
          href={`#${id}`}
          className="group/heading inline-flex items-center gap-1 no-underline"
        >
          <span>{children}</span>
          <span
            aria-hidden="true"
            className="text-primary-400 opacity-0 transition-opacity group-hover/heading:opacity-100"
          >
            #
          </span>
        </a>
      </h3>
    )
  },
  h4: function H4Component({ children }) {
    return (
      <h4 className="mt-4 mb-1.5 text-base leading-tight font-semibold text-primary-950 text-balance first:mt-0">
        {children}
      </h4>
    )
  },
  h5: function H5Component({ children }) {
    return (
      <h5 className="mt-3.5 mb-1 text-sm leading-tight font-semibold text-primary-950 text-balance first:mt-0">
        {children}
      </h5>
    )
  },
  h6: function H6Component({ children }) {
    return (
      <h6 className="mt-3.5 mb-1 text-sm leading-tight font-semibold text-primary-900 text-balance first:mt-0">
        {children}
      </h6>
    )
  },
  p: function PComponent({ children }) {
    return (
      <p className="text-primary-950 text-pretty leading-relaxed">{children}</p>
    )
  },
  ul: function UlComponent({ children }) {
    return (
      <ul className="ml-5 list-disc space-y-1 text-primary-950 marker:text-primary-400">
        {children}
      </ul>
    )
  },
  ol: function OlComponent({ children }) {
    return (
      <ol className="ml-5 list-decimal space-y-1 text-primary-950 marker:text-primary-500">
        {children}
      </ol>
    )
  },
  li: function LiComponent({ children }) {
    return <li className="leading-relaxed [&>p]:my-0">{children}</li>
  },
  a: function AComponent({ children, href }) {
    return (
      <a
        href={href}
        className="text-primary-900 underline decoration-primary-300 underline-offset-4 transition-colors hover:text-primary-950 hover:decoration-primary-600"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  },
  blockquote: function BlockquoteComponent({ children }) {
    return (
      <blockquote className="my-2 rounded-r border-l-[3px] border-primary-300 bg-primary-50/60 py-1 pl-4 pr-3 text-primary-800 [&>p]:my-1">
        {children}
      </blockquote>
    )
  },
  strong: function StrongComponent({ children }) {
    return (
      <strong className="font-semibold text-primary-950">{children}</strong>
    )
  },
  em: function EmComponent({ children }) {
    return <em className="italic text-primary-950">{children}</em>
  },
  hr: function HrComponent() {
    return <hr className="my-4 border-primary-200" />
  },
  table: function TableComponent({ children }) {
    // Wrap in overflow-x-auto so genuinely wide tables can scroll, but use
    // a layout that lets cells wrap when the bubble width can't fit them
    // (drop min-w-max + nowrap so columns shrink and text wraps instead of
    // getting clipped beyond the visible bubble).
    return (
      <div className="my-3 w-full max-w-full overflow-x-auto rounded-lg border border-primary-200 shadow-sm">
        <table className="w-full border-collapse text-sm tabular-nums">
          {children}
        </table>
      </div>
    )
  },
  thead: function TheadComponent({ children }) {
    return (
      <thead className="border-b-2 border-primary-200 bg-primary-100/70">
        {children}
      </thead>
    )
  },
  tbody: function TbodyComponent({ children }) {
    return (
      <tbody className="divide-y divide-primary-100/80">{children}</tbody>
    )
  },
  tr: function TrComponent({ children }) {
    return (
      <tr className="transition-colors odd:bg-transparent even:bg-primary-50/40 hover:bg-primary-100/40">
        {children}
      </tr>
    )
  },
  th: function ThComponent({ children }) {
    return (
      <th className="px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-primary-700 uppercase break-words">
        {children}
      </th>
    )
  },
  td: function TdComponent({ children }) {
    return (
      <td className="px-3 py-2 align-top text-primary-950 break-words">
        {children}
      </td>
    )
  },
  tfoot: function TfootComponent({ children }) {
    return (
      <tfoot className="border-t border-primary-200 bg-primary-100/40">
        {children}
      </tfoot>
    )
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content
  },
)

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock'

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  return (
    <div
      className={cn(
        'flex flex-col gap-2 break-words overflow-hidden',
        className,
      )}
    >
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = 'Markdown'

export { Markdown }
