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
  const { diceRolls: service } = dependencies;
  if (service === undefined)
    throw new ConflictError('DICE_UNAVAILABLE', 'Dice history is not configured.');
  if (request.method === 'GET')
    return success(await service.list(gameId, playerId, readDiceHistoryLimit(request)));
  if (request.method !== 'POST') throw new NotFoundError('NOT_FOUND', 'Endpoint not found.');
  // A roll is recorded only for a wallet the caller controls; anyone in the game may read it.
  await dependencies.access.requirePlayerController(gameId, actor.id, playerId);
  const body = await parseRecordDiceRollRequest(request);
  return success(await service.record(gameId, playerId, body), 201);
}

export const diceRoutes: Route<AuthedRouteContext>[] = [
  route(null, /^\/api\/games\/([^/]+)\/players\/([^/]+)\/dice-rolls$/, diceRolls),
];
