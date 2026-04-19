/**
 * Reconstruct the original public URL honoring the X-Forwarded-Proto
 * header set by our trusted reverse proxy (Caddy).
 *
 * Caddy terminates TLS and forwards to the web container over plain HTTP
 * on the internal Docker network. Node therefore sees request.url as
 * http://... even when the client request was https://. Using that URL
 * to construct OAuth redirect_to values or cookie Secure flags leads to
 * bugs (the user in turn is sent http:// URLs, and cookies miss Secure).
 *
 * This helper is only safe because the web container is NOT publicly
 * reachable — only Caddy on the internal Docker network can reach it,
 * so X-Forwarded-Proto is not attacker-controllable.
 */
export function getPublicUrl(request: Request): URL {
  const url = new URL(request.url)
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  if (forwardedProto) url.protocol = forwardedProto + ':'
  return url
}
