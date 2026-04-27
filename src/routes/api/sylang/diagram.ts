/**
 * POST /api/sylang/diagram
 *
 * Body: { filePath: string, diagramType: string, focusIdentifier?: string }
 *
 * Thin wrapper around @sylang-core/diagrams' WebDiagramTransformer. The full
 * cross-file symbol graph is supplied by the cached server-side
 * SylangSymbolManagerCore (see workspaceSymbolCache.ts), so the response
 * matches the diagram data the VSCode extension would produce locally.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { WebDiagramTransformer, DiagramType } from '@sylang-core/diagrams'
import type { ISylangLogger } from '@sylang-core/core'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

const logger: ISylangLogger = {
  l1: (m) => console.info('[Diagram]', m),
  l2: (m) => console.debug('[Diagram]', m),
  l3: (m) => console.debug('[Diagram]', m),
  debug: (m) => console.debug('[Diagram]', m),
  info: (m) => console.info('[Diagram]', m),
  warn: (m) => console.warn('[Diagram]', m),
  error: (m) => console.error('[Diagram]', m),
  show: () => {},
  hide: () => {},
  clear: () => {},
  refreshLogLevel: () => {},
  getCurrentLogLevel: () => 0 as ReturnType<ISylangLogger['getCurrentLogLevel']>,
  dispose: () => {},
}

export const Route = createFileRoute('/api/sylang/diagram')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        let body: { filePath?: string; diagramType?: string; focusIdentifier?: string }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const { filePath, diagramType, focusIdentifier } = body
        if (!filePath || !diagramType) {
          return json(
            { ok: false, error: 'filePath and diagramType are required' },
            { status: 400 },
          )
        }

        const validTypes = Object.values(DiagramType) as string[]
        if (!validTypes.includes(diagramType)) {
          return json({ ok: false, error: `Unknown diagramType: ${diagramType}` }, { status: 400 })
        }

        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(filePath, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) {
          return json({ ok: false, error: 'Invalid workspace path' }, { status: 400 })
        }

        const transformer = new WebDiagramTransformer(
          manager as never,
          logger,
          (p) => manager.readFile(p),
        )
        try {
          const result = await transformer.transformFileToDiagram(
            filePath,
            diagramType as DiagramType,
            focusIdentifier,
          )
          if (!result.success) {
            return json(
              { ok: false, error: result.error ?? 'Diagram generation failed' },
              { status: 422 },
            )
          }
          return json({ ok: true, data: result.data })
        } catch (e) {
          logger.error(`Diagram transform threw: ${e}`)
          return json({ ok: false, error: `Transform error: ${e}` }, { status: 500 })
        }
      },
    },
  },
})
