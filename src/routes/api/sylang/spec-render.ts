/**
 * POST /api/sylang/spec-render
 *
 * Body: { filePath: string }
 *
 * Parses the requested `.spec` file with `@sylang/spec-dash`'s
 * SpecParser and renders it to a self-contained HTML string via
 * WebSpecRenderer. The host's cached `ServerSymbolManager` acts as the
 * `SpecDashDataProvider` so the renderer can resolve cross-file refs
 * (`filepaths` clauses, embedded `.dash` widgets, etc.) without
 * touching disk for symbols it already has parsed.
 *
 * The response shape `{ ok, html }` is the bare HTML+inline-JS string
 * intended for an `<iframe srcDoc>` mount on the host side
 * (`src/components/spec-dash/SpecViewer.tsx`).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  SpecParser,
  WebSpecRenderer,
  WebDataFetcher,
  WebDashRenderer,
} from '@sylang/spec-dash'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

export const Route = createFileRoute('/api/sylang/spec-render')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: { filePath?: string }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const filePath = body.filePath
        if (!filePath) {
          return json({ ok: false, error: 'filePath is required' }, { status: 400 })
        }

        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(filePath, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) {
          return json({ ok: false, error: 'Invalid workspace path' }, { status: 400 })
        }

        try {
          const content = await manager.readFile(filePath)
          const specDocument = await SpecParser.parse(content, filePath)

          // The renderer needs a SpecDashDataProvider. ServerSymbolManager
          // is structurally compatible — its `allDocuments` getter returns
          // a Map<string, DocumentSymbols> where DocumentSymbols has all
          // the fields the renderer reads (uri, headerSymbol,
          // definitionSymbols). Cast through `never` to satisfy TS.
          const workspaceRoot = filePath.split('/').filter(Boolean).slice(0, 3).join('/')
          const dataFetcher = new WebDataFetcher(manager as never, workspaceRoot)
          const dashRenderer = new WebDashRenderer(dataFetcher)
          const specRenderer = new WebSpecRenderer(dataFetcher, dashRenderer)

          const rendered = await specRenderer.render(specDocument, filePath)
          return json({ ok: true, html: rendered.html })
        } catch (e) {
          console.error('[spec-render]', e)
          return json(
            { ok: false, error: `Render failed: ${e instanceof Error ? e.message : String(e)}` },
            { status: 500 },
          )
        }
      },
    },
  },
})
