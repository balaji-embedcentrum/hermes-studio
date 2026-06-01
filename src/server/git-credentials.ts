/**
 * Studio-managed git credentials for agent workspaces.
 *
 * Studio is the only party that needs to know about this — the agent runs
 * unchanged. We use the agent's existing `/ws/{repo}/file` API to read and
 * rewrite each repo's `.git/config` so that:
 *
 *   1. The origin URL is always clean (no `https://TOKEN@github.com/...`,
 *      so `git remote -v` never leaks).
 *   2. The user's *current* OAuth token lives as an `http.extraHeader` for
 *      github.com. Refreshed every time studio claims an agent for this
 *      user. Cleared on session end / unclaim.
 *
 * Trust model:
 *   - Token sits in `.git/config` on the agent's filesystem during an active
 *     claim. Same threat envelope as the rest of the workspace contents
 *     (already accepted as out-of-scope for "full app-server compromise").
 *   - Never in the remote URL. Never persisted past session end.
 *   - Always the user's *current* token — staleness bounded by re-claims,
 *     not by clone-time forever.
 *   - HTTPS-or-local transport guard before any write that carries the token.
 *
 * This module is the entire interface to that mechanism. Wire it in at:
 *   - clone (post-`/init`)        → applyCredentials
 *   - session claim               → applyCredentials per user workspace
 *   - session end / unclaim       → clearCredentials per user workspace
 */
import { assertSafeForSecretTransport } from './transport-guard'

/**
 * `.git/config` blocks we own. Matched only when the section header is for
 * github.com; we never touch other hosts' sections. Lookahead stops at the
 * next section or end-of-file, so we drop the entire block cleanly.
 */
const GITHUB_HTTP_SECTION =
  /\[http "https:\/\/github\.com\/"\][\s\S]*?(?=\n\[|\n*$)/g

/** Strip a `user@`/`token@` prefix from an `url = https://...@github.com/...` line. */
const ORIGIN_TOKEN_URL = /(url = https:\/\/)[^/@\s]*@(github\.com)/g

/**
 * Pure transform — given the current `.git/config` content and a token (or
 * null), produce the new content. Idempotent: running it twice yields the
 * same result. Exported for testing.
 */
export function rewriteGitConfig(
  currentConfig: string,
  githubToken: string | null,
): string {
  // 1. Remove any existing github.com http block we manage. (Git would
  //    *concatenate* extraHeader values from multiple blocks → two
  //    Authorization headers → bad. Always rebuild from scratch.)
  let next = currentConfig.replace(GITHUB_HTTP_SECTION, '')
  // 2. Strip credentials baked into the origin URL by legacy clones.
  next = next.replace(ORIGIN_TOKEN_URL, '$1$2')
  // 3. Normalize whitespace: collapse blank-line runs left by removal, and
  //    snap any trailing newline run to exactly one. This is what makes
  //    rewriteGitConfig idempotent — running it twice yields the same bytes.
  next = next.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n')
  if (next && !next.endsWith('\n')) next += '\n'
  // 4. Append a fresh block when we have a token. No token = leave bare;
  //    git will fail loudly on push, which is the desired post-session state.
  if (githubToken) {
    const basic = Buffer.from(`x-access-token:${githubToken}`).toString('base64')
    next += `[http "https://github.com/"]\n\textraHeader = Authorization: Basic ${basic}\n`
  }
  return next
}

async function readGitConfig(
  agentUrl: string,
  agentApiKey: string | null,
  repoName: string,
): Promise<string | null> {
  const headers: Record<string, string> = {}
  if (agentApiKey) headers['Authorization'] = `Bearer ${agentApiKey}`
  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repoName)}/file?path=${encodeURIComponent('.git/config')}`,
    { headers },
  )
  if (res.status === 404) return null  // repo not cloned on this agent
  if (!res.ok) {
    throw new Error(`read .git/config (${repoName}): ${res.status}`)
  }
  const d = (await res.json()) as { content?: string }
  return d.content ?? ''
}

async function writeGitConfig(
  agentUrl: string,
  agentApiKey: string | null,
  repoName: string,
  content: string,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (agentApiKey) headers['Authorization'] = `Bearer ${agentApiKey}`
  const res = await fetch(
    `${agentUrl}/ws/${encodeURIComponent(repoName)}/file`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: '.git/config', content }),
    },
  )
  if (!res.ok) {
    throw new Error(`write .git/config (${repoName}): ${res.status}`)
  }
}

/**
 * Install (or refresh) the github.com extraHeader for one repo on one agent.
 * No-op if the repo isn't cloned on this agent (`.git/config` 404 → silent).
 * No-op if the rewritten config is byte-identical to what was already there.
 * Pass `githubToken = null` (or use `clearCredentials`) to remove credentials.
 */
export async function applyCredentials(
  agentUrl: string,
  agentApiKey: string | null,
  repoName: string,
  githubToken: string | null,
): Promise<void> {
  if (githubToken) assertSafeForSecretTransport(agentUrl)
  const existing = await readGitConfig(agentUrl, agentApiKey, repoName)
  if (existing === null) return
  const next = rewriteGitConfig(existing, githubToken)
  if (next === existing) return
  await writeGitConfig(agentUrl, agentApiKey, repoName, next)
}

/** Convenience — same as applyCredentials(..., null). */
export async function clearCredentials(
  agentUrl: string,
  agentApiKey: string | null,
  repoName: string,
): Promise<void> {
  return applyCredentials(agentUrl, agentApiKey, repoName, null)
}
