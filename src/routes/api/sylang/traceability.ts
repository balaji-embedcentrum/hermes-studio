/**
 * GET /api/sylang/traceability?workspace=userId/owner/repo
 *
 * Returns the workspace-wide graph traversal — every symbol as a node,
 * every relationship as an edge — for the SigmaGraphTraversal renderer.
 *
 * Backed by `WebDiagramTransformer.transformToGraphTraversal()` from
 * `@sylang/diagrams`, sourced from the host's shared
 * `ServerSymbolManager` cache (same cache diagrams, spec-dash, FMEA and
 * coverage all read from), so the graph stays in lockstep with edits.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { WebDiagramTransformer } from '@sylang/diagrams'
import type { ISylangLogger } from '@sylang/core'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

const logger: ISylangLogger = {
  l1: () => {},
  l2: () => {},
  l3: () => {},
  info: () => {},
  warn: (m) => console.warn('[traceability]', m),
  error: (m) => console.error('[traceability]', m),
  debug: () => {},
  show: () => {},
  hide: () => {},
  clear: () => {},
  refreshLogLevel: () => {},
  getCurrentLogLevel: () => 0 as ReturnType<ISylangLogger['getCurrentLogLevel']>,
  dispose: () => {},
}

export const Route = createFileRoute('/api/sylang/traceability')({
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

        // The transformer constructor wants (manager, logger, readFile).
        // `manager as never` mirrors the sylang-hermes route — the
        // transformer's manager type is permissive and the structural
        // overlap with ServerSymbolManager is enough.
        const transformer = new WebDiagramTransformer(
          manager as never,
          logger,
          (p: string) => manager.readFile(p),
        )

        try {
          const graphData = await transformer.transformToGraphTraversal(`${workspace}/_.req`)
          return json({
            ok: true,
            data: graphData,
            nodeCount: graphData.nodes?.length ?? 0,
            edgeCount: graphData.edges?.length ?? 0,
          })
        } catch (err) {
          logger.error(`Transform failed: ${err}`)
          return json(
            { ok: false, error: `Graph generation failed: ${err instanceof Error ? err.message : String(err)}` },
            { status: 500 },
          )
        }
      },
    },
  },
})
