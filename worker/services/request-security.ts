import { ForbiddenError } from './errors.js';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Browser CSRF boundary. Missing Origin is retained for non-browser API clients. */
export function requireSameOriginForMutation(request: Request): void {
  if (!unsafeMethods.has(request.method)) return;
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin !== null && origin !== expectedOrigin) || fetchSite === 'cross-site')
    throw new ForbiddenError();
}

export function requireSameOriginWebSocket(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) throw new ForbiddenError();
}

export function securityHeaders(request: Request, headers: Headers): void {
  // Player colours are currently DOM style attributes; retain this narrow CSP exception
  // until they are represented as predefined CSS custom-property classes.
  headers.set(
    'content-security-policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss:; manifest-src 'self'; worker-src 'self'",
  );
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (new URL(request.url).protocol === 'https:')
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
}
