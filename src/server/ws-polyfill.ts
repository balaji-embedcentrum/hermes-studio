/**
 * Global WebSocket polyfill for Node < 22 (server-side only).
 *
 * `@supabase/supabase-js` (via `@supabase/realtime-js`) throws
 * `Error: Node.js 20 detected without native WebSocket support.`
 * the moment `createClient()` runs, because Node 20 (current LTS) has no
 * global `WebSocket` — it only became global in Node 22. That throw breaks
 * every server-side auth check (`requireAuth` → `supabase.auth.getUser`),
 * returning 401 on all API routes even with a valid session cookie.
 *
 * Node 22+ and browsers already expose a native global `WebSocket`, so this
 * is a guarded no-op there. `ws` is already a direct dependency.
 *
 * Import this module for its side effect BEFORE any `createClient()` call.
 */
import WsWebSocket from 'ws'

const globalScope = globalThis as unknown as { WebSocket?: unknown }

if (typeof globalScope.WebSocket === 'undefined') {
  globalScope.WebSocket = WsWebSocket as unknown as typeof globalThis.WebSocket
}

export {}
