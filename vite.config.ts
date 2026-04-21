import { URL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import os from 'node:os'

// devtools removed
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// nitro plugin removed (tanstackStart handles server runtime)
import { defineConfig, loadEnv } from 'vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

// ---------------------------------------------------------------------------
// Hermes Agent auto-start helpers
// ---------------------------------------------------------------------------

/** Resolve the hermes-agent directory using a priority-ordered fallback chain:
 *  1. HERMES_AGENT_PATH env var (explicit override)
 *  2. ../hermes-agent  — sibling clone (standard README setup)
 *  3. ../../hermes-agent — one level up (monorepo / nested workspace)
 *  Returns null if none found.
 */
function resolveHermesAgentDir(env: Record<string, string>): string | null {
  const candidates: string[] = []

  if (env.HERMES_AGENT_PATH?.trim()) {
    candidates.push(env.HERMES_AGENT_PATH.trim())
  }

  // Resolve relative to the workspace root (parent of hermes-workspace/)
  const workspaceRoot = dirname(resolve('.'))
  candidates.push(
    resolve(workspaceRoot, 'hermes-agent'), // sibling hermes-agent directory
    resolve(workspaceRoot, '..', 'hermes-agent'), // one level up
  )

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'webapi'))) return candidate
  }
  return null
}

/** Resolve the Python executable to use for uvicorn.
 *  Prefers .venv/bin/python inside agentDir, falls back to system python3.
 */
function resolveHermesPython(agentDir: string): string {
  const venvPython = resolve(agentDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  // uv creates 'venv' not '.venv' sometimes
  const uvVenv = resolve(agentDir, 'venv', 'bin', 'python')
  if (existsSync(uvVenv)) return uvVenv
  return 'python3'
}

/** Check if hermes-agent health endpoint is responding */
async function isHermesAgentHealthy(port = 8642): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

const config = defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hermesApiUrl = env.HERMES_API_URL?.trim() || 'http://127.0.0.1:8642'

  // Hermes Agent auto-start state
  let hermesAgentChild: ChildProcess | null = null
  let hermesAgentStarted = false

  const startHermesAgent = async () => {
    if (hermesAgentStarted) return
    // Skip auto-start when HERMES_API_URL is explicitly set to a non-local endpoint
    const explicitUrl =
      env.HERMES_API_URL || process.env.HERMES_API_URL || hermesApiUrl || ''
    if (
      explicitUrl &&
      explicitUrl !== 'http://127.0.0.1:8642' &&
      explicitUrl !== 'http://localhost:8642'
    ) {
      console.log(
        `[hermes-agent] Skipping auto-start — using external API: ${explicitUrl}`,
      )
      hermesAgentStarted = true
      return
    }
    if (await isHermesAgentHealthy()) {
      console.log('[hermes-agent] Already running — reusing existing process')
      hermesAgentStarted = true
      return
    }

    const agentDir = resolveHermesAgentDir(env)
    if (!agentDir) {
      console.warn(
        '[hermes-agent] Could not find hermes-agent directory.\n' +
          '  Set HERMES_AGENT_PATH in .env or clone hermes-agent as a sibling:\n' +
          '    git clone https://github.com/outsourc-e/hermes-agent.git ../hermes-agent',
      )
      return
    }

    const python = resolveHermesPython(agentDir)
    console.log(`[hermes-agent] Starting from ${agentDir} using ${python}`)

    const child = spawn(
      python,
      [
        '-m',
        'uvicorn',
        'webapi.app:app',
        '--host',
        '0.0.0.0',
        '--port',
        '8642',
      ],
      {
        cwd: agentDir,
        detached: false, // keep tied to vite process — stops when dev server stops
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${resolve(agentDir, '.venv', 'bin')}:${resolve(agentDir, 'venv', 'bin')}:${process.env.PATH || ''}`,
        },
      },
    )

    hermesAgentChild = child
    hermesAgentStarted = true

    child.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.log(`[hermes-agent] ${line}`)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.log(`[hermes-agent] ${line}`)
    })

    child.on('exit', (code) => {
      hermesAgentChild = null
      hermesAgentStarted = false
      if (code !== 0 && code !== null) {
        console.warn(`[hermes-agent] Exited with code ${code}`)
      }
    })

    // Wait for healthy
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await isHermesAgentHealthy()) {
        console.log('[hermes-agent] ✓ Ready on http://127.0.0.1:8642')
        return
      }
    }
    console.warn(
      '[hermes-agent] Started but health check timed out — may still be loading',
    )
  }

  // Allow access from Tailscale, LAN, or custom domains via env var
  // e.g. HERMES_ALLOWED_HOSTS=my-server.tail1234.ts.net,192.168.1.50
  const _allowedHosts: string[] | true = env.HERMES_ALLOWED_HOSTS?.trim()
    ? env
        .HERMES_ALLOWED_HOSTS!.split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : ['.ts.net'] // allow all Tailscale hostnames by default
  let proxyTarget = 'http://127.0.0.1:18789'

  try {
    const parsed = new URL(hermesApiUrl)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    parsed.pathname = ''
    proxyTarget = parsed.toString().replace(/\/$/, '')
  } catch {
    // fallback
  }

  return {
    define: {
      // Note: Do NOT set 'process.env': {} here — TanStack Start uses environment-based
      // builds where isSsrBuild is unreliable. Blanket process.env replacement breaks
      // server-side code in Docker (kills runtime env var access).
      // Client-side process.env is handled per-environment below.
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    ssr: {
      external: [
        'playwright',
        'playwright-core',
        'playwright-extra',
        'puppeteer-extra-plugin-stealth',
      ],
    },
    optimizeDeps: {
      exclude: [
        'playwright',
        'playwright-core',
        'playwright-extra',
        'puppeteer-extra-plugin-stealth',
      ],
    },
    server: {
      // Force IPv4 — 'localhost' resolves to ::1 (IPv6) on Windows, breaking connectivity
      host: '0.0.0.0',
      port: 3002,
      strictPort: false, // allow fallback if 3002 is taken, but log clearly
      allowedHosts: true,
      watch: {
        // Exclude generated route tree — TanStack Router's file watcher
        // detects its own output as a change → infinite regeneration loop
        ignored: ['**/routeTree.gen.ts'],
      },
      proxy: {
        // WebSocket proxy: clients connect to /ws-hermes on the Hermes Workspace
        // server (any IP/port), which internally forwards to the local server.
        // This means phone/LAN/Docker users never need to reach port 18789 directly.
        '/ws-hermes': {
          target: proxyTarget,
          changeOrigin: false,
          ws: true,
          rewrite: (path) => path.replace(/^\/ws-hermes/, ''),
        },
        // REST API proxy: API proxy for Hermes backend
        '/api/hermes-proxy': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/hermes-proxy/, ''),
          configure: (proxy) => {
            const apiToken = process.env.HERMES_API_TOKEN || ''
            if (apiToken) {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('Authorization', `Bearer ${apiToken}`)
              })
            }
          },
        },
        '/hermes-ui': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/hermes-ui/, ''),
          ws: true,
          configure: (proxy) => {
            proxy.on('proxyRes', (_proxyRes) => {
              // Strip iframe-blocking headers so we can embed
              delete _proxyRes.headers['x-frame-options']
              delete _proxyRes.headers['content-security-policy']
            })
          },
        },
      },
    },
    plugins: [
      // devtools(),
      // this is the plugin that enables path aliases
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      {
        name: 'hermes-agent-lifecycle',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const requestPath = req.url?.split('?')[0]
            if (req.method === 'GET' && requestPath === '/api/healthcheck') {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
              return
            }

            // Portable-aware health check — returns ok if any chat backend is available
            if (
              req.method === 'GET' &&
              requestPath === '/api/connection-status'
            ) {
              try {
                // Check for enhanced Hermes gateway first (has /api/sessions)
                const [modelsRes, sessionsRes] = await Promise.all([
                  fetch(`${hermesApiUrl}/v1/models`, {
                    signal: AbortSignal.timeout(3000),
                  }).catch(() => null),
                  fetch(`${hermesApiUrl}/api/sessions?limit=1`, {
                    signal: AbortSignal.timeout(3000),
                  }).catch(() => null),
                ])
                const hasModels = modelsRes?.ok ?? false
                const hasSessions = sessionsRes?.ok ?? false
                if (hasModels && hasSessions) {
                  res.statusCode = 200
                  res.setHeader('content-type', 'application/json')
                  res.end(
                    JSON.stringify({
                      ok: true,
                      mode: 'enhanced',
                      backend: hermesApiUrl,
                    }),
                  )
                  return
                }
                if (hasModels) {
                  res.statusCode = 200
                  res.setHeader('content-type', 'application/json')
                  res.end(
                    JSON.stringify({
                      ok: true,
                      mode: 'portable',
                      backend: hermesApiUrl,
                    }),
                  )
                  return
                }
                // Fall back to /health for full Hermes backends
                const healthRes = await fetch(`${hermesApiUrl}/health`, {
                  signal: AbortSignal.timeout(3000),
                })
                res.statusCode = healthRes.ok ? 200 : 502
                res.setHeader('content-type', 'application/json')
                res.end(
                  JSON.stringify({
                    ok: healthRes.ok,
                    mode: 'enhanced',
                    backend: hermesApiUrl,
                  }),
                )
              } catch {
                res.statusCode = 502
                res.setHeader('content-type', 'application/json')
                res.end(
                  JSON.stringify({
                    ok: false,
                    mode: 'disconnected',
                    backend: hermesApiUrl,
                  }),
                )
              }
              return
            }

            next()
          })

          // Auto-start hermes-agent when dev server launches
          if (command === 'serve') {
            void startHermesAgent()
          }

          // Shutdown hermes-agent when dev server stops
          server.httpServer?.on('close', () => {
            if (hermesAgentChild) {
              console.log('[hermes-agent] Stopping...')
              hermesAgentChild.kill('SIGTERM')
              hermesAgentChild = null
              hermesAgentStarted = false
            }
          })
        },
      },
      // Client-only: replace process.env references in client bundles
      // Server bundles must keep real process.env for Docker runtime env vars
      {
        name: 'client-process-env',
        enforce: 'pre',
        transform(code, _id) {
          const envName = this.environment?.name
          if (envName !== 'client') return null
          if (
            !code.includes('process.env') &&
            !code.includes('process.platform')
          )
            return null

          // Replace specific env vars first, then the generic fallback
          let result = code
          result = result.replace(
            /process\.env\.HERMES_API_URL/g,
            JSON.stringify(hermesApiUrl),
          )
          // Intentionally NOT replacing process.env.HERMES_API_TOKEN here:
          // HERMES_API_TOKEN is a server→agent bearer and must never be
          // baked into client bundles. Server routes reach for it via
          // process.env at runtime; client code must not reference it.
          result = result.replace(
            /process\.env\.NODE_ENV/g,
            JSON.stringify(mode),
          )
          result = result.replace(
            /process\.env\.SUPABASE_URL/g,
            JSON.stringify(env.SUPABASE_URL || ''),
          )
          result = result.replace(
            /process\.env\.SUPABASE_ANON_KEY/g,
            JSON.stringify(env.SUPABASE_ANON_KEY || ''),
          )
          result = result.replace(/process\.env/g, '{}')
          result = result.replace(/process\.platform/g, '"browser"')
          return result
        },
      },
      // Copy pty-helper.py into the server assets directory after build
      {
        name: 'copy-pty-helper',
        closeBundle() {
          const src = resolve('src/server/pty-helper.py')
          const destDir = resolve('dist/server/assets')
          const dest = resolve(destDir, 'pty-helper.py')
          if (existsSync(src)) {
            mkdirSync(destDir, { recursive: true })
            copyFileSync(src, dest)
          }
        },
      },
    ],
  }
})

export default config
