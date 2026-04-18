/**
 * Supabase auth helpers for server-side API route handlers.
 * Replaces the old password-based auth-middleware.ts
 *
 * Session token: Supabase JWT stored in HttpOnly cookie 'sb-access-token'
 * All API routes call requireAuth(request) — returns user or throws 401.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../lib/supabase'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

/**
 * Verify the Supabase JWT from the request cookie or Authorization header.
 * Returns the user's profile from our profiles table.
 * Throws a Response with status 401 if not authenticated.
 */
export async function requireAuth(request: Request): Promise<{ userId: string; profile: Profile }> {
  const token = extractToken(request)
  if (!token) {
    console.warn('[auth] No token found in request')
    throw unauthorizedResponse()
  }

  // Verify JWT with Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    console.warn('[auth] getUser failed:', error?.message, '| token prefix:', token.substring(0, 20) + '...')
    throw unauthorizedResponse()
  }

  // Load profile from our table (service role — bypasses RLS)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    // Profile missing — create it now (race condition on first request)
    const newProfile = await provisionProfile(admin, user)
    return { userId: user.id, profile: newProfile }
  }

  return { userId: user.id, profile }
}

/**
 * Like requireAuth but returns null instead of throwing — for optional auth checks.
 */
export async function getAuthUser(request: Request): Promise<{ userId: string; profile: Profile } | null> {
  try {
    return await requireAuth(request)
  } catch (err) {
    // Don't log Response objects (normal 401s) — only log real errors
    if (!(err instanceof Response)) {
      console.error('[auth] getAuthUser unexpected error:', err)
    }
    return null
  }
}

/**
 * Create profile + provision Linux UID for a new user.
 * Called on first login.
 */
export async function provisionProfile(
  admin: SupabaseClient,
  user: { id: string; email?: string; user_metadata?: Record<string, any> },
  githubToken: string | null = null,
): Promise<Profile> {
  const githubLogin = user.user_metadata?.user_name ?? user.user_metadata?.preferred_username ?? ''
  const email = user.email ?? null

  // Allocate next available Linux UID (10001–70000)
  const { data: uidRows } = await admin
    .from('profiles')
    .select('system_uid')
    .order('system_uid', { ascending: false })
    .limit(1)

  const lastUid = (uidRows as Array<{ system_uid: number | null }> | null)?.[0]?.system_uid ?? 10000
  const nextUid = lastUid + 1

  const { data: profile, error } = await admin
    .from('profiles')
    .insert([{
      id: user.id,
      github_login: githubLogin,
      github_token: githubToken,
      system_uid: nextUid,
      email,
      credits: 10,
      tier: 'free',
      push_enabled: false,
    }])
    .select()
    .maybeSingle()

  if (error || !profile) throw new Error(`Failed to create profile: ${error?.message}`)

  // Note: Linux useradd + chown /workspaces/{uid} is done by a VPS script
  // triggered via the assignment service on first workspace access, not here.

  return profile as unknown as Profile
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractToken(request: Request): string | null {
  // 1. Authorization: Bearer <token>
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)

  // 2. Cookie: sb-access-token=<token>
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/)
  if (match) return decodeURIComponent(match[1])

  return null
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
