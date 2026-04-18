/**
 * Auth middleware — secure-by-default.
 *
 * Every protected API route calls isAuthenticated() / requireLocalOrAuth()
 * which verifies a Supabase JWT via @supabase/supabase-js. No session-token
 * shortcut, no HERMES_PASSWORD bypass, no X-Forwarded-For trust.
 *
 * The legacy password flow (isPasswordProtectionEnabled/verifyPassword) is
 * kept only so the deprecated /api/auth POST still compiles; it now no-ops
 * and the route returns 410 Gone. All real auth is Supabase JWT.
 */

import { getAuthUser } from './supabase-auth'

/**
 * True iff the request carries a valid Supabase session JWT.
 * Used as `await isAuthenticated(request)`.
 */
export async function isAuthenticated(request: Request): Promise<boolean> {
  const user = await getAuthUser(request)
  return user !== null
}

/**
 * Kept for backward compatibility with existing call sites that previously
 * allowed unauthenticated requests from loopback / Tailscale / LAN.
 *
 * That "trusted network" shortcut is removed: it was exploitable by spoofing
 * X-Forwarded-For through the edge proxy. This now behaves identically to
 * isAuthenticated() and MUST return true before the caller touches the FS
 * or spawns a process.
 */
export async function requireLocalOrAuth(request: Request): Promise<boolean> {
  return isAuthenticated(request)
}

// ── Deprecated legacy password auth (no-op shims, kept for compile) ──────────

export function isPasswordProtectionEnabled(): boolean {
  return false
}

export function verifyPassword(_password: string): boolean {
  return false
}

export function generateSessionToken(): string {
  throw new Error('Deprecated — use Supabase auth via /api/auth/github')
}

export function storeSessionToken(_token: string): void {
  /* no-op */
}

export function isValidSessionToken(_token: string): boolean {
  return false
}

export function revokeSessionToken(_token: string): void {
  /* no-op */
}

export function getSessionTokenFromCookie(_cookieHeader: string | null): string | null {
  return null
}

/**
 * Kept only because /api/auth/logout expects a clear-cookie helper.
 * Emits a Set-Cookie that expires the legacy cookie with all hardening flags.
 */
export function createSessionCookie(_token: string): string {
  // Empty value + Max-Age=0 clears the cookie on the client.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `hermes-auth=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`
}
