import type { ApiError, ApiSuccess } from '../../shared/contracts/api.js';
import {
  BankingDomainError,
  InsufficientFundsError,
} from '../../shared/domain/banking.js';
import type { BankingService } from '../services/banking-service.js';
import type { GameService } from '../services/game-service.js';
import { PersistenceConsistencyError, ResourceNotFoundError } from '../services/errors.js';
import {
  ApiValidationError,
  parseCreateGameRequest,
  parseCreateTransactionRequest,
  parseResourceId,
} from '../validation/api-validation.js';

export interface ApiRouterDependencies {
  games: GameService;
  banking: BankingService;
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

  if (pathname === '/api/games') {
    if (request.method === 'GET') {
      return success(await dependencies.games.listGames());
    }
    if (request.method === 'POST') {
      return success(await dependencies.games.createGame(await parseCreateGameRequest(request)), 201);
    }
  }

  if (gameMatch !== null && request.method === 'GET') {
    return success(await dependencies.games.getGame(parseResourceId(gameMatch[1], 'gameId')));
  }

  if (gameMatch !== null && request.method === 'DELETE') {
    return success(await dependencies.games.deleteGame(parseResourceId(gameMatch[1], 'gameId')));
  }
  if (duplicateMatch !== null && request.method === 'POST') return success(await dependencies.games.duplicateGame(parseResourceId(duplicateMatch[1], 'gameId')), 201);
  if (finishMatch !== null && request.method === 'POST') return success(await dependencies.games.finishGame(parseResourceId(finishMatch[1], 'gameId')));
  if (favoriteMatch !== null && request.method === 'POST') {
    const body = await request.json() as { amount?: unknown };
    if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount <= 0) throw new ApiValidationError('amount must be a positive integer.');
    return success(await dependencies.games.toggleFavoriteAmount(parseResourceId(favoriteMatch[1], 'gameId'), body.amount));
  }

  if (transactionMatch !== null) {
    if (request.method === 'POST') {
      return success(
        await dependencies.banking.createTransaction(
          parseResourceId(transactionMatch[1], 'gameId'),
          await parseCreateTransactionRequest(request),
        ),
        201,
      );
    }
    if (request.method === 'GET') {
      return success(
        await dependencies.banking.listTransactions(
          parseResourceId(transactionMatch[1], 'gameId'),
          readHistoryLimit(request),
        ),
      );
    }
  }

  if (playerTransactionMatch !== null && request.method === 'GET') {
    return success(
      await dependencies.banking.listPlayerTransactions(
        parseResourceId(playerTransactionMatch[1], 'gameId'),
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

function success<T>(data: T, status = 200): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, { status });
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
