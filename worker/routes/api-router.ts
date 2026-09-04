import type { ApiError, ApiSuccess } from '../../shared/contracts/api.js';
import {
  BankingDomainError,
  InsufficientFundsError,
} from '../../shared/domain/banking.js';
import type { BankingService } from '../services/banking-service.js';
import type { GameService } from '../services/game-service.js';
import { AuthService, AuthenticationError } from '../services/auth-service.js';
import { GameAccessService } from '../services/game-access-service.js';
import { ProfileStatisticsService } from '../services/profile-statistics-service.js';
import { calculateWinners } from '../../shared/domain/winner-calculation.js';
import { PersistenceConsistencyError, ResourceNotFoundError } from '../services/errors.js';
import {
  ApiValidationError,
  parseCreateGameRequest,
  parseCreateTransactionRequest,
  parseBankruptcyRequest,
  parseResourceId,
  parseJoinGameRequest,
  parseLoginRequest,
  parseRegisterRequest,
  parseUpdateProfileRequest,
} from '../validation/api-validation.js';

export interface ApiRouterDependencies {
  games: GameService;
  banking: BankingService;
  auth: AuthService;
  access: GameAccessService;
  profileStatistics: ProfileStatisticsService;
}

export function createApiRouter(dependencies: ApiRouterDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      return await route(request, dependencies);
    } catch (error) {
      return mapError(error);
    }
  };
}

async function route(request: Request, dependencies: ApiRouterDependencies): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const gameMatch = /^\/api\/games\/([^/]+)$/.exec(pathname);
  const transactionMatch = /^\/api\/games\/([^/]+)\/transactions$/.exec(pathname);
  const playerTransactionMatch = /^\/api\/games\/([^/]+)\/players\/([^/]+)\/transactions$/.exec(pathname);
  const duplicateMatch = /^\/api\/games\/([^/]+)\/duplicate$/.exec(pathname);
  const finishMatch = /^\/api\/games\/([^/]+)\/finish$/.exec(pathname);
  const favoriteMatch = /^\/api\/games\/([^/]+)\/favorite-amounts$/.exec(pathname);
  const bankruptcyMatch = /^\/api\/games\/([^/]+)\/bankruptcy$/.exec(pathname);

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    const result = await dependencies.auth.register(...Object.values(await parseRegisterRequest(request)) as [string, string, string]);
    return success(result.profile, 201, result.cookie);
  }
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const result = await dependencies.auth.login(...Object.values(await parseLoginRequest(request)) as [string, string]);
    return success(result.profile, 200, result.cookie);
  }
  if (pathname === '/api/auth/logout' && request.method === 'POST') return success(null, 200, await dependencies.auth.logout(request));

  const actor = await dependencies.auth.current(request);
  if (pathname === '/api/profile') {
    if (request.method === 'GET') return success(actor);
    if (request.method === 'PATCH') { const body = await parseUpdateProfileRequest(request); return success(await dependencies.auth.update(actor.id, body.nickname, body.avatar)); }
  }
  if (pathname === '/api/games/join' && request.method === 'POST') {
    const body = await parseJoinGameRequest(request);
    const credentials = await dependencies.access.getJoinCredentials(body.joinCode);
    if (credentials === null || !(await dependencies.access.verifyGamePassword(body.gameAccessPassword, credentials))) throw new ResourceNotFoundError('Game');
    await dependencies.access.grantPlayer(credentials.gameId, actor.id, body.playerId);
    return success(await dependencies.games.getGame(credentials.gameId));
  }

  if (pathname === '/api/games') {
    if (request.method === 'GET') {
      return success(await dependencies.games.listGamesForUser(actor.id));
    }
    if (request.method === 'POST') {
      return success(await dependencies.games.createGameForOwner(actor.id, await parseCreateGameRequest(request)), 201);
    }
  }

  if (gameMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(gameMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(await dependencies.games.getGame(gameId));
  }

  if (gameMatch !== null && request.method === 'DELETE') {
    const gameId = parseResourceId(gameMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.deleteGame(gameId));
  }
  if (duplicateMatch !== null && request.method === 'POST') { const gameId = parseResourceId(duplicateMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.duplicateGame(gameId), 201); }
  if (finishMatch !== null && request.method === 'POST') { const gameId = parseResourceId(finishMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); const details = await dependencies.games.finishGame(gameId); const winnerIds = new Set(calculateWinners(details.players).map((player) => player.id)); const participants = (await dependencies.access.linkedMembers(gameId)).filter((member) => member.playerId !== null).map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) })); await dependencies.profileStatistics.recordCompletedGame(gameId, participants); return success(details); }
  if (favoriteMatch !== null && request.method === 'POST') {
    const body = await request.json() as { amount?: unknown };
    if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount <= 0) throw new ApiValidationError('amount must be a positive integer.');
    const gameId = parseResourceId(favoriteMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(await dependencies.games.toggleFavoriteAmount(gameId, body.amount));
  }

  if (bankruptcyMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(bankruptcyMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    return success(await dependencies.banking.declareBankruptcy(gameId, await parseBankruptcyRequest(request)), 201);
  }

  if (transactionMatch !== null) {
    if (request.method === 'POST') {
      const gameId = parseResourceId(transactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(
        await dependencies.banking.createTransaction(
          gameId,
          await parseCreateTransactionRequest(request),
        ),
        201,
      );
    }
    if (request.method === 'GET') {
      const gameId = parseResourceId(transactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(
        await dependencies.banking.listTransactions(
          gameId,
          readHistoryLimit(request),
        ),
      );
    }
  }

  if (playerTransactionMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(playerTransactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(
      await dependencies.banking.listPlayerTransactions(
        gameId,
        parseResourceId(playerTransactionMatch[2], 'playerId'),
        readHistoryLimit(request),
      ),
    );
  }

  return failure(404, 'NOT_FOUND', 'Endpoint not found.');
}

function readHistoryLimit(request: Request): number {
  const value = new URL(request.url).searchParams.get('limit');
  if (value === null) {
    return 100;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiValidationError('limit must be an integer between 1 and 100.');
  }
  return limit;
}

function success<T>(data: T, status = 200, cookie?: string): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, { status, ...(cookie === undefined ? {} : { headers: { 'set-cookie': cookie } }) });
}

function failure(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string | number>,
): Response {
  const error: ApiError = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return Response.json(error, { status });
}

function mapError(error: unknown): Response {
  if (error instanceof ApiValidationError) {
    return failure(400, 'VALIDATION_ERROR', error.message, error.details);
  }
  if (error instanceof AuthenticationError) return failure(401, 'UNAUTHENTICATED', 'Authentication is required.');
  if (error instanceof ResourceNotFoundError) {
    return failure(404, 'NOT_FOUND', `${error.resource} not found.`);
  }
  if (error instanceof InsufficientFundsError) {
    return failure(409, error.code, 'Insufficient funds.', {
      playerId: error.playerId,
      currentBalance: error.currentBalance,
      requiredAmount: error.requiredAmount,
      shortfall: error.shortfall,
    });
  }
  if (error instanceof BankingDomainError) {
    return failure(400, error.code, 'The banking operation is invalid.');
  }
  if (error instanceof PersistenceConsistencyError) {
    return failure(500, 'PERSISTENCE_ERROR', 'The operation could not be completed.');
  }
  return failure(500, 'INTERNAL_ERROR', 'The request could not be completed.');
}
