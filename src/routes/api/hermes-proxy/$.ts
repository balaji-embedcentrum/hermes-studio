import { createFileRoute } from '@tanstack/react-router'
import { HERMES_API, getAgentConfig } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getAuthUser } from '../../../server/supabase-auth'

async function proxyRequest(request: Request, splat: string) {
  const incomingUrl = new URL(request.url)
  const targetPath = splat.startsWith('/') ? splat : `/${splat}`

  // Route to selected remote agent if user has one configured
  let baseUrl = HERMES_API
  const authUser = await getAuthUser(request).catch(() => null)
  if (authUser?.userId) {
    try {
      const agentConfig = await getAgentConfig(authUser.userId)
      baseUrl = agentConfig.url
    } catch (e) {
      // Agent lookup failed — return error instead of silently routing to localhost
      return new Response(
        JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Agent lookup failed' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      )
    }
  }

  const targetUrl = new URL(`${baseUrl}${targetPath}`)
  targetUrl.search = incomingUrl.search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.text()
  }

  const upstream = await fetch(targetUrl, init)
  const body = await upstream.text()
  const responseHeaders = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) responseHeaders.set('content-type', contentType)
  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/hermes-proxy/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!(await isAuthenticated(request))) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      POST: async ({ request, params }) => {
        if (!(await isAuthenticated(request))) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      PATCH: async ({ request, params }) => {
        if (!(await isAuthenticated(request))) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      DELETE: async ({ request, params }) => {
        if (!(await isAuthenticated(request))) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }
        return proxyRequest(request, params._splat || '')
      },
    },
  },
})
