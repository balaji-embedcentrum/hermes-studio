/**
 * GET /api/sylang/fmea?workspace=userId/owner/repo
 *
 * Returns every symbol in the workspace flattened into the FMEASymbol
 * shape the @sylang/fmea-view workbench expects (Map<>→Record<>
 * conversion for properties). The iframe receives this list via a
 * `{ type: 'loadSymbols', symbols }` postMessage from
 * src/components/sylang-editor/inline-views/fmea-view.tsx and renders
 * its own 7-step AIAG/VDA UI.
 *
 * No FMEA-specific logic lives here — the route is purely a symbol
 * extractor. The actual FMEA analysis (risk priority numbers, sankey
 * propagation, etc.) is computed inside the iframe app.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

// FMEASymbol shape — must match @sylang/fmea-view's `FMEASymbol`
// type at runtime. We don't import from the package so the route stays
// usable even before the iframe bundle is built.
interface FMEASymbol {
  name: string
  type?: string
  kind?: string
  fileUri: string
  line: number
  column: number
  parentSymbol?: string
  children: FMEASymbol[]
  properties: Record<string, string[]>
  indentLevel?: number
  level?: string
}

function toFMEASymbol(sym: any, fileUri: string): FMEASymbol {
  return {
    name: sym.name,
    type: sym.type,
    kind: sym.kind,
    fileUri,
    line: sym.line ?? 0,
    column: sym.column ?? 0,
    parentSymbol: sym.parentSymbol,
    children: (sym.children ?? []).map((c: any) => toFMEASymbol(c, fileUri)),
    properties: Object.fromEntries((sym.properties as Map<string, string[]> | undefined) ?? new Map()),
    indentLevel: sym.indentLevel,
    level: sym.level,
  }
}

export const Route = createFileRoute('/api/sylang/fmea')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const workspace = (url.searchParams.get('workspace') ?? '').trim()
        if (!workspace) {
          return json({ ok: false, error: 'workspace param required' }, { status: 400 })
        }

        // The symbol cache is keyed by any path inside the workspace; the
        // first three segments (userId/owner/repo) are the workspace root.
        // Pass a placeholder file path so it resolves.
        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(`${workspace}/_.req`, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) {
          return json({ ok: false, error: 'Workspace not found' }, { status: 404 })
        }

        // Flatten allDocuments → FMEASymbol[]. Include both the header
        // symbol (if any) and every definition. Deduplicate by
        // (fileUri, name) since some documents reference imported
        // symbols that appear in multiple places.
        const seen = new Set<string>()
        const symbols: FMEASymbol[] = []
        for (const [fileUri, doc] of manager.allDocuments.entries()) {
          const docSyms: any[] = []
          if (doc.headerSymbol) docSyms.push(doc.headerSymbol)
          docSyms.push(...(doc.definitionSymbols ?? []))
          for (const sym of docSyms) {
            const key = `${fileUri}:${sym.name}`
            if (seen.has(key)) continue
            seen.add(key)
            symbols.push(toFMEASymbol(sym, fileUri))
          }
        }

        return json({ ok: true, symbols })
      },
    },
  },
})
