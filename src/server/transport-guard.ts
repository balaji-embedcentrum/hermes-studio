/**
 * Refuse to send a user credential to an agent endpoint over a channel that
 * isn't safe for it. Same policy used wherever studio puts a secret on the
 * wire — clone request body, .git/config file writes, anywhere else later.
 *
 * Policy: TLS required, unless the host is loopback (127.0.0.1 / ::1 /
 * localhost) or a single-label hostname (Docker / compose service name like
 * `hermes-agent`, which stays on the host's private network). Anything else
 * is treated as a non-trusted wire and rejected.
 *
 * Callers decide how to surface the rejection (HTTP 400 from a route, a
 * thrown error caught by a wrapper, etc.) — this just throws.
 */
export function assertSafeForSecretTransport(url: string): void {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    /* malformed URL — rejected below */
  }
  const isHttps = url.startsWith('https://')
  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    (host.length > 0 && !host.includes('.'))
  if (!isHttps && !isLocalHost) {
    throw new Error(
      `Refusing to send credentials over a non-HTTPS, non-local endpoint: ${url}`,
    )
  }
}
