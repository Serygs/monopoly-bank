import { GameOwnerRequiredError } from '../services/errors.js';
import { finishGameWithStatistics } from '../services/game-finish.js';
import { securityEvent } from '../services/security-events.js';
import {
  ApiValidationError,
  parseFinishGameRequest,
  parseResourceId,
} from '../validation/api-validation.js';
import {
  readCommandId,
  route,
  success,
  type AuthedRouteContext,
  type Route,
} from './route-support.js';

function gameIdOf(context: AuthedRouteContext): string {
  return parseResourceId(context.params[0], 'gameId');
}

async function ownedGameId(context: AuthedRouteContext): Promise<string> {
  const gameId = gameIdOf(context);
  await context.dependencies.access.requireOwner(gameId, context.actor.id);
  return gameId;
}

async function removeLobbyPlayer(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  const playerId = parseResourceId(context.params[1], 'playerId');
  await dependencies.access.requireOwner(gameId, actor.id);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'REMOVE_PLAYER',
      commandId: readCommandId(request),
      playerId,
    });
  await dependencies.access.removeLobbyPlayer(gameId, actor.id, playerId);
  return success(await dependencies.games.getGame(gameId));
}

async function createInvitation(context: AuthedRouteContext): Promise<Response> {
  const gameId = await ownedGameId(context);
  return success(await context.dependencies.access.createInvitation(gameId, context.actor.id), 201);
}

async function revokeInvitations(context: AuthedRouteContext): Promise<Response> {
  const gameId = await ownedGameId(context);
  await context.dependencies.access.revokeInvitations(gameId, context.actor.id);
  return success({ revoked: true });
}

async function regenerateJoinCode(context: AuthedRouteContext): Promise<Response> {
  const { requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  if ((await dependencies.access.requireMember(gameId, actor.id)) !== 'OWNER')
    throw new GameOwnerRequiredError();
  const regenerated = await dependencies.games.regenerateJoinCode(gameId, actor.id);
  // Audit trail: the event carries the game id only, never the old or the new code.
  securityEvent('join_code_regenerated', { requestId, gameId });
  return success(regenerated);
}

async function startGame(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = await ownedGameId(context);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'START_GAME',
      commandId: readCommandId(request),
    });
  return success(await dependencies.games.startGame(gameId));
}

async function finishGame(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = await ownedGameId(context);
  const body = await parseFinishGameRequest(request);
  const existing = await dependencies.games.getGame(gameId);
  const playerIds = new Set(existing.players.map((player) => player.id));
  if (body.winnerPlayerIds.some((id) => !playerIds.has(id)))
    throw new ApiValidationError('winnerPlayerIds must belong to this game.');
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'FINISH_GAME',
      commandId: readCommandId(request),
      winnerPlayerIds: body.winnerPlayerIds,
    });
  return success(
    await finishGameWithStatistics(dependencies, gameId, existing, body.winnerPlayerIds),
  );
}

export const lobbyRoutes: Route<AuthedRouteContext>[] = [
  route('DELETE', /^\/api\/games\/([^/]+)\/players\/([^/]+)$/, removeLobbyPlayer),
  route('POST', /^\/api\/games\/([^/]+)\/invitations$/, createInvitation),
  route('DELETE', /^\/api\/games\/([^/]+)\/invitations$/, revokeInvitations),
  route('POST', /^\/api\/games\/([^/]+)\/join-code\/regenerate$/, regenerateJoinCode),
  route('POST', /^\/api\/games\/([^/]+)\/start$/, startGame),
  route('POST', /^\/api\/games\/([^/]+)\/finish$/, finishGame),
];
