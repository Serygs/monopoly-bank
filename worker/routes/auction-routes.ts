import {
  parsePlaceBidRequest,
  parseResourceId,
  parseStartAuctionRequest,
} from '../validation/api-validation.js';
import {
  liveUnavailable,
  readCommandId,
  route,
  type AuthedRouteContext,
  type Route,
} from './route-support.js';

function gameIdOf(context: AuthedRouteContext): string {
  return parseResourceId(context.params[0], 'gameId');
}

// Auctions run in the game object, so they settle lazily and keep the live ordering.
async function readAuction(context: AuthedRouteContext): Promise<Response> {
  const { requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  if (dependencies.live === undefined) return liveUnavailable(requestId);
  return dependencies.live.readAuction(gameId, actor);
}

async function readVersion(context: AuthedRouteContext): Promise<Response> {
  const { requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  if (dependencies.live === undefined) return liveUnavailable(requestId);
  return dependencies.live.readVersion(gameId, actor);
}

async function startAuction(context: AuthedRouteContext): Promise<Response> {
  const { request, requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const body = await parseStartAuctionRequest(request);
  await dependencies.access.requirePlayerController(gameId, actor.id, body.initiatorPlayerId);
  if (dependencies.live === undefined) return liveUnavailable(requestId);
  return dependencies.live.mutate(gameId, actor, {
    type: 'START_AUCTION',
    commandId: readCommandId(request),
    request: body,
  });
}

async function placeBid(context: AuthedRouteContext): Promise<Response> {
  const { request, requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const body = await parsePlaceBidRequest(request, context.params[1]);
  await dependencies.access.requirePlayerController(gameId, actor.id, body.bidderPlayerId);
  if (dependencies.live === undefined) return liveUnavailable(requestId);
  return dependencies.live.mutate(gameId, actor, {
    type: 'PLACE_BID',
    commandId: readCommandId(request),
    request: body,
  });
}

export const auctionRoutes: Route<AuthedRouteContext>[] = [
  route('GET', /^\/api\/games\/([^/]+)\/auction$/, readAuction),
  route('GET', /^\/api\/games\/([^/]+)\/version$/, readVersion),
  route('POST', /^\/api\/games\/([^/]+)\/auctions$/, startAuction),
  route('POST', /^\/api\/games\/([^/]+)\/auctions\/([^/]+)\/bids$/, placeBid),
];
