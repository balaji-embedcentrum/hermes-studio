/**
 * Supabase client — browser + server
 * Browser: anon key, respects RLS
 * Server: service role key for admin ops (UID provisioning, session management)
 */

import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!

// Browser client — uses @supabase/ssr so PKCE code_verifier is stored in cookies
// (not localStorage), making server-side exchangeCodeForSession possible.
let _browserClient: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowser() {
  if (typeof window === 'undefined') throw new Error('getSupabaseBrowser() called server-side — use getSupabaseServer()')
  if (!_browserClient) {
    _browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return _browserClient
}

// Server client — use in API route handlers only
// Service role: bypasses RLS — never expose to browser
export function getSupabaseServer() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// Types matching our schema
export type Profile = {
  id: string
  github_login: string
  github_token: string | null
  system_uid: number | null
  credits: number
  // Legacy value preserved to match the Supabase profiles.tier column;
  // rename requires a DB migration, do not change this alone.
  tier: 'free' | 'pro' | 'byollm' | 'sylang_llm'
  llm_key_enc: string | null
  stripe_id: string | null
  email: string | null
  push_enabled: boolean
  created_at: string
}

export type AgentInstance = {
  id: string
  persona_name: string
  specialist_type: 'requirements' | 'architect' | 'safety' | 'verification' | 'custom'
  container_name: string
  internal_port: number
  status: 'idle' | 'busy' | 'error' | 'maintenance'
  current_session: string | null
  sessions_total: number
  last_assigned: string | null
  api_url: string | null
  model_name: string | null
  api_key: string | null
  skills: string[] | null
}

export type Workspace = {
  id: string
  user_id: string
  repo_full: string
  repo_url: string
  fs_path: string
  size_mb: number
  last_accessed: string | null
  created_at: string
}

export type Session = {
  id: string
  user_id: string
  workspace_id: string
  agent_id: string | null
  specialist_type: string
  persona_name: string | null
  status: 'active' | 'ended' | 'timed_out' | 'crashed'
  credits_charged: number
  llm_provider: string | null
  llm_model: string | null
  tokens_in: number
  tokens_out: number
  session_file: string | null
  started_at: string
  ends_at: string | null
  ended_at: string | null
}
