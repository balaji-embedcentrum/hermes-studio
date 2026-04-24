/**
 * Agent Session Management — server-side logic for session lifecycle.
 *
 * Handles: start, end, status check, idle timeout, cooldown, health checks.
 * All Supabase queries use service-role client (admin).
 *
 * Local agents are exempt — no session limits, no cooldown.
 */

import { getSupabaseServer } from '../lib/supabase'

// ── Constants ────────────────────────────────────────────────────────
export const SESSION_DURATION_MS = 30 * 60 * 1000        // 30 min
export const SESSION_WARNING_MS = 25 * 60 * 1000         // warn at 25 min (5 min before end)
export const COOLDOWN_MS = 30 * 1000                     // 30 sec cooldown
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000            // 10 min idle = session end
export const HEALTH_CHECK_INTERVAL_MS = 60 * 1000        // ping every 60s
export const HEALTH_FAIL_THRESHOLD = 3                    // 3 fails = unavailable

export const TIER_LIMITS: Record<string, { sessionsPerMonth: number; autoRenew: boolean; unlimited: boolean }> = {
  free:  { sessionsPerMonth: 10,  autoRenew: false, unlimited: false },
  pro:   { sessionsPerMonth: 100, autoRenew: true,  unlimited: false },
  ultra: { sessionsPerMonth: -1,  autoRenew: true,  unlimited: true },
}

// ── Types ────────────────────────────────────────────────────────────
export type AgentStatus = 'available' | 'in_use' | 'cooling_down' | 'unavailable'
export type SessionEndReason = 'expired' | 'user_ended' | 'idle' | 'logout' | 'account_deleted' | 'admin'

export type SessionInfo = {
  sessionId: string
  agentId: string
  agentName: string
  startedAt: string
  expiresAt: string
  timeRemainingMs: number
  status: 'active' | 'expired' | 'ended'
}

export type StartSessionResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; error: string; code: 'no_credits' | 'agent_unavailable' | 'already_active' | 'agent_locked' }

// ── Start Session ────────────────────────────────────────────────────
export async function startSession(userId: string, agentId: string): Promise<StartSessionResult> {
  const db = getSupabaseServer()

  // 1. Check user tier + credits
  const { data: profile } = await db
    .from('profiles')
    .select('tier, sessions_used, sessions_reset_at, github_login')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found', code: 'no_credits' }

  const tier = TIER_LIMITS[profile.tier] ?? TIER_LIMITS.free

  // Reset monthly counter if needed
  const resetAt = new Date(profile.sessions_reset_at)
  const now = new Date()
  if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
    await db.from('profiles').update({ sessions_used: 0, sessions_reset_at: now.toISOString() }).eq('id', userId)
    profile.sessions_used = 0
  }

  if (!tier.unlimited && profile.sessions_used >= tier.sessionsPerMonth) {
    return { ok: false, error: `You've used all ${tier.sessionsPerMonth} sessions this month. Upgrade your plan.`, code: 'no_credits' }
  }

  // 2. Check if user already has an active session
  const { data: existing } = await db
    .from('agent_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)

  if (existing && existing.length > 0) {
    return { ok: false, error: 'You already have an active session. End it first.', code: 'already_active' }
  }

  // 3. Check agent availability
  const { data: agent } = await db
    .from('agent_instances')
    .select('id, persona_name, agent_status, locked_to_user, cooldown_until, api_url, api_key')
    .eq('id', agentId)
    .single()

  if (!agent) return { ok: false, error: 'Agent not found', code: 'agent_unavailable' }

  // Check if locked to another Ultra user
  if (agent.locked_to_user && agent.locked_to_user !== userId) {
    return { ok: false, error: `${agent.persona_name} is dedicated to another user.`, code: 'agent_locked' }
  }

  // Check cooldown expiry (auto-flip if past)
  if (agent.agent_status === 'cooling_down' && agent.cooldown_until) {
    if (new Date(agent.cooldown_until) <= now) {
      await db.from('agent_instances').update({ agent_status: 'available', cooldown_until: null }).eq('id', agentId)
      agent.agent_status = 'available'
    }
  }

  if (agent.agent_status !== 'available' && agent.locked_to_user !== userId) {
    const statusMsg: Record<string, string> = {
      in_use: `${agent.persona_name} is currently in use. Try another agent.`,
      cooling_down: `${agent.persona_name} is cooling down. Available in a moment.`,
      unavailable: `${agent.persona_name} is offline.`,
    }
    return { ok: false, error: statusMsg[agent.agent_status] ?? 'Agent unavailable', code: 'agent_unavailable' }
  }

  // 4. Claim the agent FIRST — this bind-mounts the user's workspace
  // into the agent container (kernel-enforced isolation) and waits for
  // /v1/health to come back up. Must succeed before we create a session
  // row, otherwise we'd hand the user a "valid" session pointing at an
  // agent that can't serve them.
  if (agent.api_url && profile.github_login) {
    const claim = await claimAgent(
      agent.api_url,
      agent.api_key,
      profile.github_login,
    )
    if (!claim.ok) {
      // Mark the agent unavailable so it stops showing up as selectable
      // on /agents. An admin (or the periodic health check) will flip
      // it back to available once the underlying issue is fixed.
      await db
        .from('agent_instances')
        .update({
          agent_status: 'unavailable',
          health_fail_count: HEALTH_FAIL_THRESHOLD,
          last_health_check: now.toISOString(),
        })
        .eq('id', agentId)

      const human: Record<string, string> = {
        unreachable: `${agent.persona_name} is unreachable right now. Try another agent.`,
        timeout: `${agent.persona_name} didn't respond in time. Try another agent.`,
        auth_failed: `${agent.persona_name} rejected our credentials. An admin has been notified.`,
        conflict: `${agent.persona_name} is currently being claimed by another user. Try another agent.`,
        health_timeout: `${agent.persona_name} restarted but didn't come back healthy. Try another agent.`,
        server_error: `${agent.persona_name} failed to start. Try another agent.`,
      }
      return {
        ok: false,
        error: human[claim.reason] ?? `Failed to claim ${agent.persona_name}.`,
        code: 'agent_unavailable',
      }
    }
  }

  // 5. Create session + update agent status
  // NB: `status: 'active'` is set explicitly — every read path filters
  // `.eq('status', 'active')`, so if the DB column lacks a default the
  // insert lands as NULL and the UI permanently shows "No active session".
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)
  const { data: session, error: sessErr } = await db
    .from('agent_sessions')
    .insert({
      user_id: userId,
      agent_id: agentId,
      status: 'active',
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_activity_at: now.toISOString(),
    })
    .select('id')
    .single()

  if (sessErr || !session) {
    console.error('[sessions] Failed to create session:', sessErr?.message)
    // Try to unclaim so the agent doesn't sit with a bind mount
    // belonging to a user who has no session.
    if (agent.api_url) {
      unclaimAgent(agent.api_url, agent.api_key).catch(() => {})
    }
    return { ok: false, error: 'Failed to create session', code: 'agent_unavailable' }
  }

  // Mark agent as in_use (session authoritative — unused agents never
  // transition here, so the status reflects reality).
  await db.from('agent_instances').update({
    agent_status: 'in_use',
    cooldown_until: null,
  }).eq('id', agentId)

  // Increment sessions used
  await db.from('profiles').update({
    sessions_used: (profile.sessions_used ?? 0) + 1,
    selected_agent_id: agentId,
  }).eq('id', userId)

  return {
    ok: true,
    session: {
      sessionId: session.id,
      agentId,
      agentName: agent.persona_name,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      timeRemainingMs: SESSION_DURATION_MS,
      status: 'active',
    },
  }
}

// ── End Session ──────────────────────────────────────────────────────
export async function endSession(
  userId: string,
  reason: SessionEndReason = 'user_ended',
): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseServer()
  const now = new Date()

  // Find active session
  const { data: session } = await db
    .from('agent_sessions')
    .select('id, agent_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!session) return { ok: true } // no active session, nothing to do

  // End the session
  await db.from('agent_sessions').update({
    status: 'ended',
    ended_at: now.toISOString(),
    ended_reason: reason,
  }).eq('id', session.id)

  // Deactivate workspace on the agent (remove symlink)
  const { data: agent } = await db
    .from('agent_instances')
    .select('api_url, api_key')
    .eq('id', session.agent_id)
    .single()
  if (agent?.api_url) {
    await deactivateWorkspace(agent.api_url, agent.api_key)
  }

  // Set agent to cooling down
  const cooldownUntil = new Date(now.getTime() + COOLDOWN_MS)
  await db.from('agent_instances').update({
    agent_status: 'cooling_down',
    cooldown_until: cooldownUntil.toISOString(),
  }).eq('id', session.agent_id)

  return { ok: true }
}

// ── Get Session Status ───────────────────────────────────────────────
//
// READ-ONLY. Must not mutate. The previous implementation called
// endSession() inline whenever it observed an expired or idle row,
// which meant the act of *looking* at session state could destroy it.
// The chat UI calls /api/agent-sessions/status on every page load via
// useActiveSession; reloading after >IDLE_TIMEOUT_MS of debugging
// would silently kill the session and surface as a "permanently
// locked" UI even though the user had just started one.
//
// Lifecycle enforcement (kicking idle/expired sessions) belongs to
// validateSession(), which is called from the chat-send and file-op
// paths and intentionally has write semantics.
export async function getSessionStatus(userId: string): Promise<SessionInfo | null> {
  const db = getSupabaseServer()
  const now = new Date()

  const { data: session } = await db
    .from('agent_sessions')
    .select('id, agent_id, started_at, expires_at, status, last_activity_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!session) return null

  const expiresAt = new Date(session.expires_at)

  // Hide expired rows from the UI (they're already past their wall-clock
  // life), but do not end them here — let validateSession do that on the
  // next write.
  if (expiresAt <= now) return null

  // Get agent name
  const { data: agent } = await db
    .from('agent_instances')
    .select('persona_name')
    .eq('id', session.agent_id)
    .single()

  return {
    sessionId: session.id,
    agentId: session.agent_id,
    agentName: agent?.persona_name ?? 'Unknown',
    startedAt: session.started_at,
    expiresAt: session.expires_at,
    timeRemainingMs: expiresAt.getTime() - now.getTime(),
    status: 'active',
  }
}

// ── Touch Session (update last activity) ─────────────────────────────
export async function touchSession(userId: string): Promise<void> {
  const db = getSupabaseServer()
  await db.from('agent_sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'active')
}

// ── Validate Session (for enforcement on every request) ──────────────
export async function validateSession(userId: string): Promise<
  | { valid: true; sessionId: string; agentUrl: string; agentKey?: string; autoRenewed?: boolean }
  | { valid: false; error: string; code: 'no_session' | 'expired' | 'idle' }
> {
  const db = getSupabaseServer()
  const now = new Date()

  const { data: session } = await db
    .from('agent_sessions')
    .select('id, agent_id, expires_at, last_activity_at, user_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!session) {
    return { valid: false, error: 'No active session', code: 'no_session' }
  }

  const expiresAt = new Date(session.expires_at)

  // Check idle
  const lastActivity = new Date(session.last_activity_at)
  if (now.getTime() - lastActivity.getTime() > IDLE_TIMEOUT_MS) {
    await endSession(userId, 'idle')
    return { valid: false, error: 'Session ended due to inactivity', code: 'idle' }
  }

  // Check expired
  if (expiresAt <= now) {
    // Check if Pro/Ultra can auto-renew
    const { data: profile } = await db
      .from('profiles')
      .select('tier, sessions_used, sessions_reset_at')
      .eq('id', userId)
      .single()

    const tier = TIER_LIMITS[profile?.tier ?? 'free'] ?? TIER_LIMITS.free

    if (tier.autoRenew && (tier.unlimited || (profile?.sessions_used ?? 0) < tier.sessionsPerMonth)) {
      // Auto-renew: end old session, start new one silently
      const agentId = session.agent_id
      await db.from('agent_sessions').update({
        status: 'ended',
        ended_at: now.toISOString(),
        ended_reason: 'expired',
      }).eq('id', session.id)

      const newExpiresAt = new Date(now.getTime() + SESSION_DURATION_MS)
      const { data: newSession } = await db
        .from('agent_sessions')
        .insert({
          user_id: userId,
          agent_id: agentId,
          status: 'active',
          started_at: now.toISOString(),
          expires_at: newExpiresAt.toISOString(),
          last_activity_at: now.toISOString(),
        })
        .select('id')
        .single()

      if (!tier.unlimited) {
        await db.from('profiles').update({
          sessions_used: (profile?.sessions_used ?? 0) + 1,
        }).eq('id', userId)
      }

      // Get agent info
      const { data: agent } = await db
        .from('agent_instances')
        .select('api_url, api_key')
        .eq('id', agentId)
        .single()

      return {
        valid: true,
        sessionId: newSession?.id ?? session.id,
        agentUrl: agent?.api_url ?? '',
        agentKey: agent?.api_key ?? undefined,
        autoRenewed: true,
      }
    }

    // Free tier: hard stop
    await endSession(userId, 'expired')
    return { valid: false, error: 'Session expired', code: 'expired' }
  }

  // Valid — update activity timestamp
  await touchSession(userId)

  // Get agent info
  const { data: agent } = await db
    .from('agent_instances')
    .select('api_url, api_key')
    .eq('id', session.agent_id)
    .single()

  return {
    valid: true,
    sessionId: session.id,
    agentUrl: agent?.api_url ?? '',
    agentKey: agent?.api_key ?? undefined,
  }
}

// ── Health Check All Agents ──────────────────────────────────────────
export async function runHealthChecks(): Promise<{
  checked: number
  unavailable: number
  recovered: number
  sweptExpired: number
  sweptIdle: number
}> {
  const db = getSupabaseServer()
  const now = new Date()
  let unavailable = 0
  let recovered = 0

  const { data: agents } = await db
    .from('agent_instances')
    .select('id, api_url, agent_status, health_fail_count')
    .not('api_url', 'is', null)

  if (!agents) {
    return { checked: 0, unavailable: 0, recovered: 0, sweptExpired: 0, sweptIdle: 0 }
  }

  for (const agent of agents) {
    if (!agent.api_url) continue
    // Skip agents in active use — don't disrupt
    if (agent.agent_status === 'in_use') continue

    try {
      // Agents in the fleet expose health under different paths depending
      // on which server is bound to a given route prefix — the hermes
      // OpenAI-compat gateway uses /v1/health, while a plain A2A adapter
      // has no /health at all but bounces /v1/health to its aiohttp peer.
      // Probe /health first, fall back to /v1/health, and only mark the
      // agent unhealthy if both fail.
      const res = await probeAgentHealth(agent.api_url)
      if (res.ok) {
        // Healthy — reset fail count, recover if was unavailable
        if (agent.agent_status === 'unavailable') {
          await db.from('agent_instances').update({
            agent_status: 'available',
            health_fail_count: 0,
            last_health_check: now.toISOString(),
          }).eq('id', agent.id)
          recovered++
        } else {
          await db.from('agent_instances').update({
            health_fail_count: 0,
            last_health_check: now.toISOString(),
          }).eq('id', agent.id)
        }
      } else {
        throw new Error(`HTTP ${res.status}`)
      }
    } catch {
      const failCount = (agent.health_fail_count ?? 0) + 1
      if (failCount >= HEALTH_FAIL_THRESHOLD) {
        await db.from('agent_instances').update({
          agent_status: 'unavailable',
          health_fail_count: failCount,
          last_health_check: now.toISOString(),
        }).eq('id', agent.id)
        unavailable++
      } else {
        await db.from('agent_instances').update({
          health_fail_count: failCount,
          last_health_check: now.toISOString(),
        }).eq('id', agent.id)
      }
    }
  }

  // Also flip expired cooldowns to available
  await db.from('agent_instances')
    .update({ agent_status: 'available', cooldown_until: null })
    .eq('agent_status', 'cooling_down')
    .lt('cooldown_until', now.toISOString())

  // Sweep expired + idle active sessions. Without this, sessions that
  // the user never touches again (closed laptop, idle tab, expired
  // without a chat send) stay forever at status='active', keeping
  // their agent marked in_use and blocking the user from starting a
  // new session. validateSession() only runs on write paths, so we
  // need a timer-driven sweep for the fully-idle case.
  const sweptExpired = await sweepExpiredSessions(db, now)
  const sweptIdle = await sweepIdleSessions(db, now)

  return {
    checked: agents.length,
    unavailable,
    recovered,
    sweptExpired,
    sweptIdle,
  }
}

// Returns how many active rows were flipped to ended.
type SupabaseServerClient = ReturnType<typeof getSupabaseServer>
async function sweepExpiredSessions(
  db: SupabaseServerClient,
  now: Date,
): Promise<number> {
  const { data: rows } = await db
    .from('agent_sessions')
    .select('id, user_id, agent_id')
    .eq('status', 'active')
    .lt('expires_at', now.toISOString())

  if (!rows || rows.length === 0) return 0
  for (const row of rows) {
    await endSession(row.user_id, 'expired')
  }
  return rows.length
}

async function sweepIdleSessions(
  db: SupabaseServerClient,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_TIMEOUT_MS).toISOString()
  const { data: rows } = await db
    .from('agent_sessions')
    .select('id, user_id, agent_id, expires_at')
    .eq('status', 'active')
    .lt('last_activity_at', cutoff)
    // Expired rows are already handled by sweepExpiredSessions; avoid
    // double-ending and reporting the same row twice.
    .gte('expires_at', now.toISOString())

  if (!rows || rows.length === 0) return 0
  for (const row of rows) {
    await endSession(row.user_id, 'idle')
  }
  return rows.length
}

// ── End All Sessions for User (logout / delete) ──────────────────────
export async function endAllUserSessions(userId: string, reason: SessionEndReason): Promise<void> {
  const db = getSupabaseServer()
  const now = new Date()

  const { data: sessions } = await db
    .from('agent_sessions')
    .select('id, agent_id')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (!sessions || sessions.length === 0) return

  for (const session of sessions) {
    await db.from('agent_sessions').update({
      status: 'ended',
      ended_at: now.toISOString(),
      ended_reason: reason,
    }).eq('id', session.id)

    // Deactivate workspace on the agent
    const { data: agent } = await db
      .from('agent_instances')
      .select('api_url, api_key')
      .eq('id', session.agent_id)
      .single()
    if (agent?.api_url) {
      await deactivateWorkspace(agent.api_url, agent.api_key)
    }

    const cooldownUntil = new Date(now.getTime() + COOLDOWN_MS)
    await db.from('agent_instances').update({
      agent_status: 'cooling_down',
      cooldown_until: cooldownUntil.toISOString(),
    }).eq('id', session.agent_id)
  }
}

// ── Health Probe ─────────────────────────────────────────────────────

const HEALTH_PROBE_PATHS = ['/health', '/v1/health'] as const
const HEALTH_PROBE_TIMEOUT_MS = 5_000

/**
 * Probe an agent's health across the known paths. Returns the first
 * response that reports `ok`; if none do, returns the last response (or
 * a synthetic 0-status result if every path threw). Callers only need
 * to check `res.ok`.
 *
 * Rationale: agents in the Akela fleet run two servers side-by-side
 * behind a path-prefix reverse proxy. The hermes OpenAI-compat gateway
 * exposes /v1/health, while the A2A adapter has no /health at all. A
 * single-path probe produces a false-negative whenever the probe hits
 * the A2A side — try both so the check is robust across configs.
 */
async function probeAgentHealth(agentUrl: string): Promise<{ ok: boolean; status: number }> {
  let lastStatus = 0
  for (const path of HEALTH_PROBE_PATHS) {
    try {
      const res = await fetch(`${agentUrl}${path}`, {
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      })
      if (res.ok) return { ok: true, status: res.status }
      lastStatus = res.status
    } catch {
      // Network / timeout — try the next path.
    }
  }
  return { ok: false, status: lastStatus }
}

// ── Workspace Isolation Helpers ──────────────────────────────────────

/**
 * Derive the agent's lowercase key from its api_url. Used as the suffix
 * for the per-agent active-workspace symlink (`active-{key}`) so the
 * shared fleet adapter can keep N concurrent users isolated, one per
 * agent. For URLs of the form `https://host/agent-isabelle`, returns
 * `isabelle`. For BYO agents whose URL doesn't include the `/agent-X`
 * suffix, returns `primary` — those adapters are single-tenant anyway,
 * so the symlink name is a constant.
 */
function deriveAgentKey(apiUrl: string): string {
  const match = apiUrl.match(/\/agent-([a-z0-9][a-z0-9_-]*)\/?$/)
  return match ? match[1] : 'primary'
}

/**
 * Derive the fleet base URL from an agent URL. The fleet control plane
 * (/fleet/claim etc.) lives at the root of the agents VPS, not under
 * any per-agent prefix. Agent api_url is of the form
 * `https://agents-akela.example.com/agent-isabelle`; fleet base is
 * `https://agents-akela.example.com`. For BYO agents whose URL
 * doesn't include an `/agent-<name>` suffix, the base is the api_url
 * itself and agentKey falls back to `primary`.
 */
function deriveFleetBase(apiUrl: string): string {
  return apiUrl.replace(/\/agent-[a-z0-9][a-z0-9_-]*\/?$/, '')
}

export type ClaimResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'unreachable'
        | 'timeout'
        | 'auth_failed'
        | 'conflict'
        | 'health_timeout'
        | 'server_error'
      message: string
      status?: number
    }

/**
 * Claim a cloud-fleet agent for the given user. Asks the fleet control
 * plane to swap the agent container's workspace bind mount to the
 * user's directory and force-recreate it. Blocks until the agent's
 * `/v1/health` comes back up (the adapter does the health wait before
 * returning).
 *
 * Kernel-enforced isolation: after a successful claim the agent can
 * only see the claimed user's files at /opt/workspaces. Any previous
 * user's data is no longer mounted. No symlink tricks, no escape via
 * absolute paths — the mount point is the only filesystem the container
 * has.
 *
 * BYO agents (user_vps, user_tunnel) are single-tenant and don't need
 * to be claimed — their URL won't match the `/agent-<name>` pattern,
 * so deriveFleetBase returns the apiUrl itself. For those, this call
 * is a no-op that still succeeds, so callers don't have to branch.
 */
async function claimAgent(
  agentUrl: string,
  apiKey: string | null,
  githubLogin: string,
): Promise<ClaimResult> {
  const agentKey = deriveAgentKey(agentUrl)
  // BYO / single-tenant: no fleet plane to call, treat as success.
  if (agentKey === 'primary') {
    return { ok: true }
  }

  const fleetBase = deriveFleetBase(agentUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    // Fleet claim = docker compose force-recreate + health wait. Takes
    // 2-10s typically. Timeout well above that so we don't abandon a
    // successful recreate and leave the fleet in a weird state.
    const res = await fetch(`${fleetBase}/fleet/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agent: agentKey, user: githubLogin }),
      signal: AbortSignal.timeout(45_000),
    })
    if (res.ok) {
      console.info(
        `[sessions] Claimed agent=${agentKey} for ${githubLogin} on ${fleetBase}`,
      )
      return { ok: true }
    }
    const body = await res.text().catch(() => '')
    let reason: ClaimResult & { ok: false } = {
      ok: false,
      reason: 'server_error',
      message: body || res.statusText,
      status: res.status,
    }
    if (res.status === 401 || res.status === 403) {
      reason = { ok: false, reason: 'auth_failed', message: 'fleet control bearer rejected', status: res.status }
    } else if (res.status === 409) {
      reason = { ok: false, reason: 'conflict', message: 'agent is busy', status: res.status }
    } else if (res.status === 504) {
      reason = { ok: false, reason: 'health_timeout', message: 'agent did not become healthy after recreate', status: res.status }
    }
    console.error(
      `[sessions] Claim failed agent=${agentKey} user=${githubLogin} status=${res.status} reason=${reason.reason} body=${body.slice(0, 500)}`,
    )
    return reason
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isTimeout = msg.includes('timed out') || msg.includes('AbortError')
    console.error(`[sessions] Claim network error agent=${agentKey}:`, msg)
    return {
      ok: false,
      reason: isTimeout ? 'timeout' : 'unreachable',
      message: msg,
    }
  }
}

/**
 * Release the agent — tears down the user-specific bind mount. The
 * container stays running with the sentinel (empty) mount so it keeps
 * heartbeating and can be claimed by the next user later.
 *
 * Fire-and-forget semantics: failures are logged but don't block the
 * session-end path. If the unclaim genuinely fails, the next claim
 * will force-recreate and fix it.
 */
async function unclaimAgent(agentUrl: string, apiKey: string | null): Promise<void> {
  const agentKey = deriveAgentKey(agentUrl)
  if (agentKey === 'primary') return // BYO — nothing to unclaim

  const fleetBase = deriveFleetBase(agentUrl)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${fleetBase}/fleet/unclaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agent: agentKey }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error(`[sessions] Unclaim failed agent=${agentKey}: ${res.status}`)
    } else {
      console.info(`[sessions] Unclaimed agent=${agentKey} on ${fleetBase}`)
    }
  } catch (e) {
    console.error(`[sessions] Unclaim network error agent=${agentKey}:`, e)
  }
}

// Back-compat shims so existing callers don't churn until we clean up
// the callsites. New code should call claimAgent / unclaimAgent.
async function activateWorkspace(agentUrl: string, apiKey: string | null, githubLogin: string): Promise<void> {
  const result = await claimAgent(agentUrl, apiKey, githubLogin)
  if (!result.ok) {
    // Preserve the legacy "log and continue" behavior here — startSession
    // handles the claim call directly with proper error propagation.
    console.error(`[sessions] activateWorkspace wrapper: claim failed reason=${result.reason} message=${result.message}`)
  }
}

async function deactivateWorkspace(agentUrl: string, apiKey: string | null): Promise<void> {
  await unclaimAgent(agentUrl, apiKey)
}
