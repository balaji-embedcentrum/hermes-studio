/**
 * GET /api/sylang/symbol-details?id=REQ-001&workspacePath=userId/login/repo/...
 *
 * Returns the symbol definition for the given ID, using the server-side
 * WorkspaceSymbolCache (real SylangSymbolManagerCore from sylang2.1).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { getWorkspaceManager } from '../../../sylang/symbolManager/workspaceSymbolCache'
import type { SylangSymbol } from '@sylang-core/core'
import path from 'node:path'

export const Route = createFileRoute('/api/sylang/symbol-details')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const url = new URL(request.url)
        const symbolId = (url.searchParams.get('id') ?? '').trim()
        const workspacePath = (url.searchParams.get('workspacePath') ?? '').trim()

        if (!symbolId) return json({ ok: false, error: 'id param required' }, { status: 400 })
        if (!workspacePath) return json({ ok: false, error: 'workspacePath required' }, { status: 400 })

        // Look up the user's selected agent URL — files live there, not in
        // the local hermes-studio process's workspace dir.
        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(workspacePath, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) return json({ ok: false, error: 'Workspace not found' }, { status: 404 })

        // Search all documents for this symbol
        for (const doc of manager.allDocuments.values()) {
          if (doc.headerSymbol?.name === symbolId) {
            return json({ ok: true, symbol: toSymbolPayload(doc.headerSymbol, doc.uri) })
          }
          const found = findInSymbols(doc.definitionSymbols, symbolId)
          if (found) {
            return json({ ok: true, symbol: toSymbolPayload(found, doc.uri) })
          }
        }

        return json({ ok: false, error: `Symbol '${symbolId}' not found` })
      },
    },
  },
})

function findInSymbols(symbols: SylangSymbol[], id: string): SylangSymbol | null {
  for (const sym of symbols) {
    if (sym.name === id) return sym
    if (sym.children?.length) {
      const found = findInSymbols(sym.children, id)
      if (found) return found
    }
  }
  return null
}

function toSymbolPayload(sym: SylangSymbol, filePath: string) {
  const properties: Record<string, string> = {}
  for (const [k, v] of sym.properties.entries()) {
    const val = Array.isArray(v) ? v.join(', ') : String(v)
    if (val.trim()) properties[k] = val
  }
  return {
    name: sym.name,
    kind: sym.kind,
    type: sym.type,
    properties,
    fileName: path.basename(filePath),
    filePath,
    line: sym.line,
  }
}
