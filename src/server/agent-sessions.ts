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

  // 4. Create session + update agent status
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)
  const { data: session, error: sessErr } = await db
    .from('agent_sessions')
    .insert({
      user_id: userId,
      agent_id: agentId,
      expires_at: expiresAt.toISOString(),
      last_activity_at: now.toISOString(),
    })
    .select('id')
    .single()

  if (sessErr || !session) {
    console.error('[sessions] Failed to create session:', sessErr?.message)
    return { ok: false, error: 'Failed to create session', code: 'agent_unavailable' }
  }

  // Mark agent as in_use
  await db.from('agent_instances').update({
    agent_status: 'in_use',
    cooldown_until: null,
  }).eq('id', agentId)

  // Activate user workspace on the agent (symlink isolation)
  if (agent.api_url && profile.github_login) {
    await activateWorkspace(agent.api_url, agent.api_key, profile.github_login)
  }

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

  // Check if expired
  if (expiresAt <= now) {
    await endSession(userId, 'expired')
    return null
  }

  // Check idle timeout
  const lastActivity = new Date(session.last_activity_at)
  if (now.getTime() - lastActivity.getTime() > IDLE_TIMEOUT_MS) {
    await endSession(userId, 'idle')
    return null
  }

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
export async function runHealthChecks(): Promise<{ checked: number; unavailable: number; recovered: number }> {
  const db = getSupabaseServer()
  const now = new Date()
  let unavailable = 0
  let recovered = 0

  const { data: agents } = await db
    .from('agent_instances')
    .select('id, api_url, agent_status, health_fail_count')
    .not('api_url', 'is', null)

  if (!agents) return { checked: 0, unavailable: 0, recovered: 0 }

  for (const agent of agents) {
    if (!agent.api_url) continue
    // Skip agents in active use — don't disrupt
    if (agent.agent_status === 'in_use') continue

    try {
      const res = await fetch(`${agent.api_url}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
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

  return { checked: agents.length, unavailable, recovered }
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

// ── Workspace Isolation Helpers ──────────────────────────────────────

/**
 * Activate a user's workspace on the agent.
 * Creates a symlink: {HERMES_WORKSPACE_DIR}/active → {HERMES_WORKSPACE_DIR}/{githubLogin}
 * The agent can only see files under the "active" symlink.
 */
async function activateWorkspace(agentUrl: string, apiKey: string | null, githubLogin: string): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${agentUrl}/ws/activate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user: githubLogin }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error(`[sessions] Failed to activate workspace for ${githubLogin}: ${res.status}`)
    } else {
      console.info(`[sessions] Activated workspace for ${githubLogin} on ${agentUrl}`)
    }
  } catch (e) {
    console.error(`[sessions] Error activating workspace:`, e)
  }
}

/**
 * Deactivate the workspace on the agent.
 * Removes the "active" symlink so the agent cannot see any user's files.
 */
async function deactivateWorkspace(agentUrl: string, apiKey: string | null): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${agentUrl}/ws/deactivate`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error(`[sessions] Failed to deactivate workspace: ${res.status}`)
    } else {
      console.info(`[sessions] Deactivated workspace on ${agentUrl}`)
    }
  } catch (e) {
    console.error(`[sessions] Error deactivating workspace:`, e)
  }
}
