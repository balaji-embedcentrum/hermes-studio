/**
 * POST /api/workspaces/create
 * Body: { name }
 *
 * Creates a new project. To work around the agent's `init empty:true`
 * path-construction bug (which lands new projects at
 * <root>/<first-subdir>/<slug> instead of <root>/<gh-owner>/<slug>),
 * this handler creates a private GitHub repository for the user first,
 * then asks the agent to clone it through the URL-init branch. The
 * clone branch's path logic already lands projects at the same level
 * as every other cloned repo, so the on-disk layout stays consistent.
 *
 * Trade-off: a real private GitHub repository is created as a side
 * effect. The user can push to it immediately and delete it later if
 * they don't want it.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'
import { getAgentConfig } from '../../../server/gateway-capabilities'
import { assertSafeForSecretTransport } from '../../../server/transport-guard'
import { applyCredentials } from '../../../server/git-credentials'

type GitHubRepoResponse = {
  id?: number
  full_name?: string
  html_url?: string
  clone_url?: string
  message?: string
  errors?: Array<{ resource?: string; code?: string; message?: string }>
}

async function createGithubRepo(
  token: string,
  name: string,
  description: string,
): Promise<{ ok: true; clone_url: string; html_url: string } | { ok: false; status: number; error: string }> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description,
      private: true,
      auto_init: true,
    }),
  }).catch(() => null)

  if (!res) {
    return { ok: false, status: 502, error: 'GitHub API unreachable' }
  }

  const body = (await res.json().catch(() => ({}))) as GitHubRepoResponse

  if (!res.ok || !body.clone_url || !body.html_url) {
    const firstFieldError = body.errors?.[0]?.message
    const errorMessage = firstFieldError ?? body.message ?? `GitHub returned ${res.status}`
    return { ok: false, status: res.status, error: errorMessage }
  }

  return { ok: true, clone_url: body.clone_url, html_url: body.html_url }
}

export const Route = createFileRoute('/api/workspaces/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { name } = (await request.json()) as { name: string }
        if (!name?.trim()) {
          return json({ error: 'Project name required' }, { status: 400 })
        }

        const projectName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
        const ghLogin = auth.profile.github_login
        const ghToken = auth.githubToken

        if (!ghLogin || !ghToken) {
          return json(
            {
              error:
                'Your GitHub session is missing — sign out and sign in again so we can create the project repo on GitHub.',
            },
            { status: 400 },
          )
        }

        const agentConfig = await getAgentConfig(auth.userId).catch(() => null)
        const agentUrl = agentConfig?.url
        if (!agentUrl) {
          return json(
            { error: 'No agent selected. Go to Agents page first.' },
            { status: 400 },
          )
        }

        try {
          // 1) Create a private GitHub repo for the project. We bypass
          //    the agent's broken empty-init path by routing through the
          //    clone branch, which requires a real remote.
          const ghCreate = await createGithubRepo(
            ghToken,
            projectName,
            `Sylang Studio project: ${projectName}`,
          )

          if (!ghCreate.ok) {
            return json(
              {
                error:
                  ghCreate.status === 422
                    ? `A GitHub repo named "${projectName}" already exists on your account. ` +
                      `Pick a different project name, or open the existing repo from the Clone tab.`
                    : `Could not create GitHub repo: ${ghCreate.error}`,
              },
              { status: ghCreate.status === 422 ? 409 : 502 },
            )
          }

          const repoFull = `${ghLogin}/${projectName}`
          const cloneHttpsUrl = ghCreate.clone_url

          // 2) Ask the agent to clone the new repo through the URL-init
          //    branch. Same code path as the regular Clone flow, which
          //    has been producing the correct on-disk layout.
          const agentHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (agentConfig?.apiKey) {
            agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`
          }

          try {
            assertSafeForSecretTransport(agentUrl)
          } catch (e) {
            return json(
              { error: (e as Error).message },
              { status: 400 },
            )
          }

          // Token-bearing URL so the agent can clone a brand-new private
          // repo without prior credential bootstrap.
          const cloneAuthedUrl = `https://${ghToken}@github.com/${repoFull}.git`

          const initRes = await fetch(
            `${agentUrl}/ws/${encodeURIComponent(projectName)}/init`,
            {
              method: 'POST',
              headers: agentHeaders,
              body: JSON.stringify({ url: cloneAuthedUrl }),
            },
          ).catch(() => null)

          if (!initRes) {
            return json(
              {
                error:
                  'Agent unreachable after GitHub repo was created. ' +
                  `The empty repo lives at ${ghCreate.html_url} — retry from the Clone tab once the agent is back.`,
                github_repo_url: ghCreate.html_url,
              },
              { status: 502 },
            )
          }

          const initBody = (await initRes.json().catch(() => ({}))) as {
            status?: string
            action?: string
            path?: string
            message?: string
          }

          if (!initRes.ok || initBody.status !== 'ok') {
            return json(
              {
                error:
                  `Agent failed to clone the new project: ${initBody.message ?? `init returned ${initRes.status}`}. ` +
                  `The empty repo lives at ${ghCreate.html_url} — retry from the Clone tab.`,
                github_repo_url: ghCreate.html_url,
              },
              { status: 502 },
            )
          }

          // 3) Rewrite the .git/config to drop the token from the origin
          //    URL — same hardening the regular Clone flow applies.
          await applyCredentials(
            agentUrl,
            agentConfig?.apiKey ?? null,
            projectName,
            ghToken,
          ).catch((err) =>
            console.warn(
              `[workspaces/create] post-clone credential rewrite failed for ${projectName}:`,
              err instanceof Error ? err.message : err,
            ),
          )

          // 4) Verify the agent can find the workspace back via /tree.
          const treeRes = await fetch(
            `${agentUrl}/ws/${encodeURIComponent(projectName)}/tree`,
            { headers: agentHeaders },
          ).catch(() => null)

          if (!treeRes || !treeRes.ok) {
            return json(
              {
                error:
                  'Project cloned but the agent cannot find it back via /tree. ' +
                  'This usually means the agent and workspace storage are out of sync.',
                agent_reported_path: initBody.path ?? null,
                github_repo_url: ghCreate.html_url,
              },
              { status: 502 },
            )
          }

          // 5) Register in Supabase. Store the agent's reported path so
          //    cleanup tooling has a real on-disk reference.
          const admin = getSupabaseServer()
          const fsPath = initBody.path ?? `/workspaces/${auth.userId}/${repoFull}`

          await admin.from('workspaces').upsert(
            [
              {
                user_id: auth.userId,
                repo_full: repoFull,
                repo_url: ghCreate.html_url,
                fs_path: fsPath,
                size_mb: 0,
              },
            ],
            { onConflict: 'user_id,repo_full' },
          )

          const workspacePath = `${auth.userId}/${repoFull}`

          return json({
            ok: true,
            path: workspacePath,
            agent_reported_path: initBody.path ?? null,
            github_repo_url: ghCreate.html_url,
          })
        } catch (e) {
          console.error('[workspaces/create]', e)
          return json(
            { error: `Failed to create project: ${e}` },
            { status: 500 },
          )
        }
      },
    },
  },
})
