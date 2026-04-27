/**
 * Variant Matrix API
 *
 * GET  /api/sylang/variant-matrix?path=<workspacePath>
 *   Returns VariantMatrixData for the FML/VML at `path`.
 *
 * POST /api/sylang/variant-matrix
 *   Body: { action: 'toggleFeature', variantPath, featureId, selected }
 *       | { action: 'createVariant', fmlPath, variantId, variantName, description, owner }
 *       | { action: 'selectVariantForVcf', vmlPath, variantName }
 *
 * All compute + mutation logic lives in @sylang-core/variant-matrix. This
 * route does only auth, agent-URL resolution, file IO (via the agent), and
 * cache invalidation.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  computeVariantMatrix,
  createVariantVml,
  generateVcfFromVml,
  toggleFeatureInVml,
} from '@sylang-core/variant-matrix'
import { getAuthUser } from '../../../server/supabase-auth'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import {
  getWorkspaceManager,
  type ServerSymbolManager,
} from '../../../sylang/symbolManager/workspaceSymbolCache'

interface AgentLocator {
  url: string | null
  apiKey?: string
}

/** Write a workspace-relative path through the user's agent. Throws on failure. */
async function writeViaAgent(
  agent: AgentLocator,
  workspacePath: string,
  newContent: string,
): Promise<void> {
  if (!agent.url) {
    throw new Error('No agent URL — cannot write')
  }
  const parts = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3) throw new Error('Invalid workspace path')
  const repo = parts[2]
  const relInRepo = parts.slice(3).join('/')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (agent.apiKey) headers['Authorization'] = `Bearer ${agent.apiKey}`

  const r = await fetch(`${agent.url}/ws/${encodeURIComponent(repo)}/file`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: relInRepo, content: newContent }),
  })
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(`Agent write failed (${r.status}): ${d.message ?? r.statusText}`)
  }
}

async function commitMutation(
  manager: ServerSymbolManager,
  agent: AgentLocator,
  filePath: string,
  newContent: string,
): Promise<void> {
  await writeViaAgent(agent, filePath, newContent)
  // Keep the in-memory cache in sync so subsequent matrix fetches reflect
  // the just-written file (otherwise users see stale selections).
  await manager.parseContent(filePath, newContent).catch(() => {})
}

export const Route = createFileRoute('/api/sylang/variant-matrix')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        const url = new URL(request.url)
        const rawPath = (url.searchParams.get('path') ?? '').trim()
        if (!rawPath) return json({ ok: false, error: 'path param required' }, { status: 400 })

        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const manager = await getWorkspaceManager(rawPath, {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        })
        if (!manager) {
          return json({ ok: false, error: 'Invalid workspace path' }, { status: 400 })
        }

        try {
          const matrix = await computeVariantMatrix(manager, rawPath)
          return json({ ok: true, matrix })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return json({ ok: false, error: msg }, { status: 422 })
        }
      },

      POST: async ({ request }) => {
        const authUser = await getAuthUser(request).catch(() => null)
        if (!authUser) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }

        const action = body.action as string
        const agentConfig = await getAgentConfig(authUser.userId).catch(() => null)
        const agent: AgentLocator = {
          url: agentConfig?.url ?? null,
          apiKey: agentConfig?.apiKey,
        }

        async function loadManager(filePath: string): Promise<ServerSymbolManager> {
          const m = await getWorkspaceManager(filePath, agent)
          if (!m) throw new Error('Invalid workspace path')
          return m
        }

        try {
          switch (action) {
            case 'toggleFeature': {
              const variantPath = String(body.variantPath ?? '')
              const featureId = String(body.featureId ?? '')
              const selected = Boolean(body.selected)
              if (!variantPath || !featureId) {
                return json(
                  { ok: false, error: 'variantPath + featureId required' },
                  { status: 400 },
                )
              }
              const manager = await loadManager(variantPath)
              const result = await toggleFeatureInVml(
                manager,
                variantPath,
                featureId,
                selected,
              )
              await commitMutation(manager, agent, result.variantPath, result.newContent)
              return json({
                ok: true,
                type: 'featureToggled',
                variantName: result.variantName,
                featureId: result.featureId,
                selected: result.selected,
              })
            }

            case 'createVariant': {
              const fmlPath = String(body.fmlPath ?? '')
              const variantId = String(body.variantId ?? '')
              const variantName = String(body.variantName ?? '')
              if (!fmlPath || !variantId) {
                return json(
                  { ok: false, error: 'fmlPath + variantId required' },
                  { status: 400 },
                )
              }
              const manager = await loadManager(fmlPath)
              const result = await createVariantVml(manager, {
                fmlPath,
                variantId,
                variantName,
                description: typeof body.description === 'string' ? body.description : '',
                owner: typeof body.owner === 'string' ? body.owner : '',
              })
              await commitMutation(manager, agent, result.vmlPath, result.vmlContent)
              return json({
                ok: true,
                type: 'variantCreated',
                name: result.variantId,
                path: result.vmlPath,
                success: true,
              })
            }

            case 'selectVariantForVcf': {
              const vmlPath = String(body.vmlPath ?? '')
              const variantName = String(body.variantName ?? '')
              if (!vmlPath) {
                return json({ ok: false, error: 'vmlPath required' }, { status: 400 })
              }
              const manager = await loadManager(vmlPath)
              const result = await generateVcfFromVml(manager, vmlPath, variantName)
              await commitMutation(manager, agent, result.vcfPath, result.vcfContent)
              return json({ ok: true, type: 'vcfGenerated', vcfPath: result.vcfPath })
            }

            default:
              return json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return json({ ok: false, error: msg }, { status: 422 })
        }
      },
    },
  },
})
