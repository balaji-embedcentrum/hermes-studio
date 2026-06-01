/**
 * POST /api/sylang/dash-render
 *
 * Body: { filePath: string }
 *
 * Parses the requested `.dash` file with `@sylang/spec-dash`'s
 * DashParser and renders it to a self-contained HTML string (with
 * inline Chart.js) via WebDashRenderer. Mirrors `/api/sylang/spec-render`
 * but skips the spec-side composition step — a `.dash` file is rendered
 * as a standalone dashboard page.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  DashParser,
  WebDashRenderer,
  WebDataFetcher,
} from '@sylang/spec-dash'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'

export const Route = createFileRoute('/api/sylang/dash-render')({
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

          const parser = new DashParser()
          const dashDocument = parser.parseText(content)
          if (!dashDocument) {
            return json(
              { ok: false, error: 'Failed to parse .dash file (check syntax)' },
              { status: 422 },
            )
          }

          const workspaceRoot = filePath.split('/').filter(Boolean).slice(0, 3).join('/')
          const dataFetcher = new WebDataFetcher(manager as never, workspaceRoot)
          const dashRenderer = new WebDashRenderer(dataFetcher)

          // sylang-core's DashParser returns the richer dashTypes.DashDocument;
          // WebDashRenderer.render accepts the renderer-types DashDocument.
          // The shapes overlap on every field the renderer reads (header,
          // widgets), so the cast is safe.
          const rendered = await dashRenderer.render(
            dashDocument as never,
          )
          return json({ ok: true, html: rendered.html })
        } catch (e) {
          console.error('[dash-render]', e)
          return json(
            { ok: false, error: `Render failed: ${e instanceof Error ? e.message : String(e)}` },
            { status: 500 },
          )
        }
      },
    },
  },
})
