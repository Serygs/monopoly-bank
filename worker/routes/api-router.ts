import { handleError } from '../services/error-handler.js';
import { NotFoundError } from '../services/errors.js';
import { requireSameOriginForMutation, securityHeaders } from '../services/request-security.js';
import { securityEvent } from '../services/security-events.js';
import { auctionRoutes } from './auction-routes.js';
import { authedAuthRoutes, publicAuthRoutes } from './auth-routes.js';
import { bankingRoutes } from './banking-routes.js';
import { diceRoutes } from './dice-routes.js';
import { gameRoutes } from './game-routes.js';
import { historyRoutes } from './history-routes.js';
import { authedJoinRoutes, publicJoinRoutes } from './join-routes.js';
import { lobbyRoutes } from './lobby-routes.js';
import { enforceRateLimit } from './rate-limit.js';
import {
  matchRoute,
  type ApiRouterDependencies,
  type AuthedRouteContext,
  type PublicRouteContext,
  type Route,
} from './route-support.js';

export type { ApiRouterDependencies } from './route-support.js';

const PUBLIC_ROUTES: readonly Route<PublicRouteContext>[] = [
  ...publicAuthRoutes,
  ...publicJoinRoutes,
];

const AUTHED_ROUTES: readonly Route<AuthedRouteContext>[] = [
  ...authedAuthRoutes,
  ...authedJoinRoutes,
  ...gameRoutes,
  ...historyRoutes,
  ...lobbyRoutes,
  ...auctionRoutes,
  ...bankingRoutes,
  ...diceRoutes,
];

export function createApiRouter(dependencies: ApiRouterDependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = readRequestId(request);
    const path = new URL(request.url).pathname;
    let renewedCookie: string | undefined;
    try {
      try {
        requireSameOriginForMutation(request);
      } catch (error) {
        securityEvent('csrf_rejected', { requestId });
        throw error;
      }
      await enforceRateLimit(request, dependencies.rateLimits, requestId);
      const response = await dispatch(request, dependencies, requestId, (cookie) => {
        renewedCookie = cookie;
      });
      // Re-wrapping an HTTP 101 response drops Cloudflare's `webSocket` field.
      // Return the Durable Object response intact so the browser upgrade completes.
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);
      if (renewedCookie !== undefined && !headers.has('set-cookie'))
        headers.set('set-cookie', renewedCookie);
      securityHeaders(request, headers);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const response = handleError(error, {
        requestId,
        method: request.method,
        path,
        cloudflareRayId: request.headers.get('cf-ray'),
      });
      const headers = new Headers(response.headers);
      securityHeaders(request, headers);
      if (renewedCookie !== undefined) headers.set('set-cookie', renewedCookie);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  };
}

async function dispatch(
  request: Request,
  dependencies: ApiRouterDependencies,
  requestId: string,
  onSessionRenewed: (cookie: string) => void,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const publicMatch = matchRoute(PUBLIC_ROUTES, request.method, pathname);
  if (publicMatch !== null)
    return publicMatch.route.handle({
      request,
      dependencies,
      requestId,
      params: publicMatch.params,
    });
  const actor = await dependencies.auth.current(
    request,
    requestId,
    request.headers.get('upgrade')?.toLowerCase() === 'websocket' ? undefined : onSessionRenewed,
  );
  const match = matchRoute(AUTHED_ROUTES, request.method, pathname);
  if (match === null) throw new NotFoundError('NOT_FOUND', 'Endpoint not found.');
  return match.route.handle({ request, dependencies, requestId, params: match.params, actor });
}

function readRequestId(request: Request): string {
  const candidate = request.headers.get('x-request-id');
  return candidate !== null && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(candidate)
    ? candidate
    : crypto.randomUUID();
}
