/**
 * GET /api/sylang/coverage?workspace=userId/owner/repo
 *
 * Coverage analysis — every symbol in the workspace classified as one of
 * five states (`isolated` / `orphan` / `sink` / `connected` / `broken`)
 * with per-symbol outgoing + incoming relationship detail.
 *
 * Backed by `TraceabilityMatrixBuilder` from `@sylang/traceability`
 * (the same headless builder that powers the matrix view), reading from
 * the host's shared `ServerSymbolManager` cache — so coverage stays in
 * lockstep with diagrams, spec-dash, and FMEA.
 *
 * Response shape mirrors the legacy sylang-hermes route so the inline
 * `coverage-view.tsx` component is a near-verbatim port.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { TraceabilityMatrixBuilder } from '@sylang/traceability'
import type { ISylangLogger } from '@sylang/core'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

// Minimal logger — the builder only emits debug noise, nothing the
// browser needs to see. console.warn / console.error are kept live so
// genuine problems still surface in server logs.
const logger: ISylangLogger = {
  l1: () => {},
  l2: () => {},
  l3: () => {},
  info: () => {},
  warn: (m) => console.warn('[coverage]', m),
  error: (m) => console.error('[coverage]', m),
  debug: () => {},
  show: () => {},
  hide: () => {},
  clear: () => {},
  refreshLogLevel: () => {},
  getCurrentLogLevel: () => 0 as ReturnType<ISylangLogger['getCurrentLogLevel']>,
  dispose: () => {},
}

export const Route = createFileRoute('/api/sylang/coverage')({
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

        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(`${workspace}/_.req`, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) {
          return json({ ok: false, error: 'Workspace not found' }, { status: 404 })
        }

        const builder = new TraceabilityMatrixBuilder(manager, logger)
        const matrix = builder.buildMatrixData(`${workspace}/_.coverage`)
        const analyses = builder.extractSymbolAnalyses(matrix)

        // Bucket counts in one pass while shaping the payload — saves
        // a second iteration on what can be thousands of symbols.
        const statusCounts = { isolated: 0, orphan: 0, sink: 0, connected: 0, broken: 0 }
        const symbols = analyses.map((a) => {
          statusCounts[a.status]++
          return {
            name: a.symbol.name,
            kind: a.symbol.kind,
            fileName: a.symbol.fileUri.split('/').pop() ?? '',
            // Full path so the inline view can fire onNavigate(fileUri,
            // symbolName) and the editor opens the right file with the
            // symbol scrolled into view + highlighted.
            fileUri: a.symbol.fileUri,
            outgoing: a.outgoingCount,
            incoming: a.incomingCount,
            broken: a.brokenOutgoingCount,
            status: a.status,
            outgoingRelationships: a.outgoingRelationships ?? [],
            incomingRelationships: a.incomingRelationships ?? [],
          }
        })

        return json({
          ok: true,
          symbols,
          summary: {
            total: symbols.length,
            ...statusCounts,
            brokenRefCount: symbols.reduce((s, r) => s + r.broken, 0),
          },
        })
      },
    },
  },
})
