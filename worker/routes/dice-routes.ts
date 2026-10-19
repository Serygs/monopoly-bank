import { ConflictError, NotFoundError } from '../services/errors.js';
import { parseRecordDiceRollRequest, parseResourceId } from '../validation/api-validation.js';
import {
  readDiceHistoryLimit,
  route,
  success,
  type AuthedRouteContext,
  type Route,
} from './route-support.js';

async function diceRolls(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = parseResourceId(context.params[0], 'gameId');
  await dependencies.access.requireMember(gameId, actor.id);
  const playerId = parseResourceId(context.params[1], 'playerId');
  const { diceRolls: service, live } = dependencies;
  if (service === undefined && live === undefined) throw diceUnavailable();
  if (request.method === 'GET') {
    const limit = readDiceHistoryLimit(request);
    if (live !== undefined) return live.listDiceRolls(gameId, actor, playerId, limit);
    if (service === undefined) throw diceUnavailable();
    return success(await service.list(gameId, playerId, limit));
  }
  if (request.method !== 'POST') throw new NotFoundError('NOT_FOUND', 'Endpoint not found.');
  // A roll is recorded only for a wallet the caller controls; anyone in the game may read it.
  await dependencies.access.requirePlayerController(gameId, actor.id, playerId);
  const body = await parseRecordDiceRollRequest(request);
  if (live !== undefined) return live.recordDiceRoll(gameId, actor, playerId, body);
  if (service === undefined) throw diceUnavailable();
  return success(await service.record(gameId, playerId, body), 201);
}

function diceUnavailable(): ConflictError {
  return new ConflictError('DICE_UNAVAILABLE', 'Dice history is not configured.');
}

export const diceRoutes: Route<AuthedRouteContext>[] = [
  route(null, /^\/api\/games\/([^/]+)\/players\/([^/]+)\/dice-rolls$/, diceRolls),
];
