import {
  ApiValidationError,
  parseCreateGameRequest,
  parseDuplicateGameRequest,
  parseResourceId,
} from '../validation/api-validation.js';
import { route, success, walletIds, type AuthedRouteContext, type Route } from './route-support.js';

function gameIdOf(context: AuthedRouteContext): string {
  return parseResourceId(context.params[0], 'gameId');
}

async function listDeleted({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(await dependencies.games.listDeletedGamesForUser(actor.id));
}

async function listGames({ dependencies, actor }: AuthedRouteContext): Promise<Response> {
  return success(await dependencies.games.listGamesForUser(actor.id));
}

async function createGame({ request, dependencies, actor }: AuthedRouteContext) {
  return success(
    await dependencies.games.createGameForOwner(actor.id, await parseCreateGameRequest(request)),
    201,
  );
}

async function readGame(context: AuthedRouteContext): Promise<Response> {
  const { dependencies, actor } = context;
  const gameId = gameIdOf(context);
  const role = await dependencies.access.requireMember(gameId, actor.id);
  const controlledWallets = await dependencies.access.controlledWallets(gameId, actor.id);
  const details = await dependencies.games.getGame(gameId);
  const tradeRequests =
    details.game.settings?.board == null
      ? {}
      : {
          tradeRequests: await dependencies.banking.listTradeRequests(
            gameId,
            walletIds(controlledWallets),
          ),
        };
  const ownerFields =
    role === 'OWNER'
      ? {
          joinCode: await dependencies.access.ownerJoinCode(gameId, actor.id),
          hasAccessPassword: await dependencies.access.hasAccessPassword(gameId),
        }
      : {};
  return success({
    ...details,
    ...tradeRequests,
    controlledWallets,
    controlledPlayerIds: walletIds(controlledWallets),
    canManage: role === 'OWNER',
    ...ownerFields,
  });
}

async function deleteGame(context: AuthedRouteContext): Promise<Response> {
  const gameId = gameIdOf(context);
  await context.dependencies.access.requireOwner(gameId, context.actor.id);
  return success(await context.dependencies.games.deleteGame(gameId));
}

async function restoreGame(context: AuthedRouteContext): Promise<Response> {
  const gameId = gameIdOf(context);
  return success(await context.dependencies.games.restoreGame(gameId, context.actor.id));
}

async function duplicateGame(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireOwner(gameId, actor.id);
  return success(
    await dependencies.games.duplicateGameForOwner(
      actor.id,
      gameId,
      (await parseDuplicateGameRequest(request)).gameAccessPassword,
    ),
    201,
  );
}

async function toggleFavoriteAmount(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const body = (await request.json()) as { amount?: unknown };
  if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount <= 0)
    throw new ApiValidationError('amount must be a positive integer.');
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  return success(await dependencies.games.toggleFavoriteAmount(gameId, body.amount));
}

export const gameRoutes: Route<AuthedRouteContext>[] = [
  route('GET', /^\/api\/games\/deleted$/, listDeleted),
  route('GET', /^\/api\/games$/, listGames),
  route('POST', /^\/api\/games$/, createGame),
  route('GET', /^\/api\/games\/([^/]+)$/, readGame),
  route('DELETE', /^\/api\/games\/([^/]+)$/, deleteGame),
  route('POST', /^\/api\/games\/([^/]+)\/restore$/, restoreGame),
  route('POST', /^\/api\/games\/([^/]+)\/duplicate$/, duplicateGame),
  route('POST', /^\/api\/games\/([^/]+)\/favorite-amounts$/, toggleFavoriteAmount),
];
