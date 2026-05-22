/**
 * POST /api/workspaces/clone
 * Checks if a workspace repo is cloned on the agent. If not, clones it and streams progress.
 * Response: SSE stream of { type: 'progress'|'ready'|'error', message }
 */
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { assertSafeForSecretTransport } from '../../../server/transport-guard'
import { applyCredentials } from '../../../server/git-credentials'

export const Route = createFileRoute('/api/workspaces/clone')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }

        const { workspace_id } = await request.json() as { workspace_id: string }
        if (!workspace_id) {
          return new Response(JSON.stringify({ error: 'workspace_id required' }), { status: 400 })
        }

        const admin = getSupabaseServer()
        const { data: workspace } = await admin
          .from('workspaces')
          .select('*')
          .eq('id', workspace_id)
          .eq('user_id', auth.userId)
          .single()

        if (!workspace) {
          return new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 })
        }

        const repoFull: string = workspace.repo_full
        const relativePath = path.join(auth.userId, repoFull)
        const repoName = repoFull.split('/').pop() ?? repoFull

        // Resolve the user's selected agent URL
        const agentConfig = await getAgentConfig(auth.userId).catch(() => null)
        const agentUrl = agentConfig?.url
        if (!agentUrl) {
          return new Response(JSON.stringify({ error: 'No agent selected. Go to Agents page first.' }), { status: 400 })
        }
        const agentHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (agentConfig?.apiKey) agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`

        const token = auth.githubToken

        if (token) {
          try {
            assertSafeForSecretTransport(agentUrl)
          } catch (e) {
            return new Response(
              JSON.stringify({ error: (e as Error).message }),
              { status: 400 },
            )
          }
        }

        // We still send a token-bearing URL to `/init` because the agent
        // needs *some* credential to clone a private repo and we can't
        // pre-write .git/config (it doesn't exist yet). Immediately after
        // clone we rewrite .git/config (origin → clean, token → extraHeader)
        // so the token never persists in the URL form past first claim.
        const cloneUrl = token
          ? `https://${token}@github.com/${repoFull}.git`
          : `https://github.com/${repoFull}.git`

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const send = (type: string, message: string) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, message })}\n\n`))
            }

            // Check if already cloned on agent
            try {
              const check = await fetch(`${agentUrl}/ws/${encodeURIComponent(repoName)}/tree`, { headers: agentHeaders })
              if (check.ok) {
                admin.from('workspaces').update({ last_accessed: new Date().toISOString() }).eq('id', workspace_id).then(() => {})
                send('ready', relativePath)
                controller.close()
                return
              }
            } catch { /* not reachable, will error below */ }

            // Clone on agent
            send('progress', `Cloning ${repoFull}...`)
            try {
              const r = await fetch(`${agentUrl}/ws/${encodeURIComponent(repoName)}/init`, {
                method: 'POST',
                headers: agentHeaders,
                body: JSON.stringify({ url: cloneUrl }),
              })
              const d = await r.json() as { status?: string; message?: string }
              if (d.status === 'ok') {
                // Post-clone: swap the token out of origin URL into an
                // http.extraHeader in .git/config. Best-effort — the clone
                // succeeded either way, this just hardens the credential
                // shape. Future claims will re-run the same rewrite with
                // the user's then-current token.
                if (token) {
                  await applyCredentials(agentUrl, agentConfig?.apiKey ?? null, repoName, token)
                    .catch((err) =>
                      console.warn(
                        `[clone] post-clone credential rewrite failed for ${repoName}:`,
                        err instanceof Error ? err.message : err,
                      ),
                    )
                }
                admin.from('workspaces').update({ last_accessed: new Date().toISOString() }).eq('id', workspace_id).then(() => {})
                send('ready', relativePath)
              } else {
                send('error', d.message ?? `Agent returned status ${r.status}`)
              }
            } catch (err) {
              send('error', err instanceof Error ? err.message : 'Agent unreachable')
            }

            controller.close()
          },
        })

        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        })
      },
    },
  },
})
