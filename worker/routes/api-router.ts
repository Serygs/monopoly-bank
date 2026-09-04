import type { ApiSuccess } from '../../shared/contracts/api.js';
import type { BankingService } from '../services/banking-service.js';
import type { GameService } from '../services/game-service.js';
import { AuthService } from '../services/auth-service.js';
import { GameAccessService } from '../services/game-access-service.js';
import { ProfileStatisticsService } from '../services/profile-statistics-service.js';
import type { GameLiveGateway } from '../services/game-live-gateway.js';
import { calculateWinners } from '../../shared/domain/winner-calculation.js';
import { calculateFinalGameSummary } from '../../shared/domain/game-summary.js';
import { InvalidJoinCodeError, NotFoundError } from '../services/errors.js';
import { handleError } from '../services/error-handler.js';
import {
  ApiValidationError,
  parseCreateGameRequest,
  parseCreateTransactionRequest,
  parseDuplicateGameRequest,
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
  live?: GameLiveGateway;
}

export function createApiRouter(dependencies: ApiRouterDependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = readRequestId(request);
    const path = new URL(request.url).pathname;
    try {
      const response = await route(request, dependencies, requestId);
      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      return handleError(error, { requestId, method: request.method, path, cloudflareRayId: request.headers.get('cf-ray') });
    }
  };
}

async function route(request: Request, dependencies: ApiRouterDependencies, requestId: string): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const gameMatch = /^\/api\/games\/([^/]+)$/.exec(pathname);
  const transactionMatch = /^\/api\/games\/([^/]+)\/transactions$/.exec(pathname);
  const playerTransactionMatch = /^\/api\/games\/([^/]+)\/players\/([^/]+)\/transactions$/.exec(pathname);
  const duplicateMatch = /^\/api\/games\/([^/]+)\/duplicate$/.exec(pathname);
  const finishMatch = /^\/api\/games\/([^/]+)\/finish$/.exec(pathname);
  const favoriteMatch = /^\/api\/games\/([^/]+)\/favorite-amounts$/.exec(pathname);
  const bankruptcyMatch = /^\/api\/games\/([^/]+)\/bankruptcy$/.exec(pathname);
  const summaryMatch = /^\/api\/games\/([^/]+)\/summary$/.exec(pathname);
  const liveMatch = /^\/api\/games\/([^/]+)\/live$/.exec(pathname);

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
    if (credentials === null || !(await dependencies.access.verifyGamePassword(body.gameAccessPassword, credentials))) throw new InvalidJoinCodeError();
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
    const gameId = parseResourceId(gameMatch[1], 'gameId'); const role = await dependencies.access.requireMember(gameId, actor.id);
    return success({ ...(await dependencies.games.getGame(gameId)), canManage: role === 'OWNER', ...(role === 'OWNER' ? { joinCode: await dependencies.access.ownerJoinCode(gameId, actor.id) } : {}) });
  }

  if (liveMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(liveMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const details = await dependencies.games.getGame(gameId);
    if (details.game.status !== 'ACTIVE') return failure(409, 'GAME_FINISHED', 'This game is finished.', requestId);
    return dependencies.live === undefined ? failure(503, 'LIVE_UNAVAILABLE', 'Live games are not configured.', requestId) : dependencies.live.connect(gameId, actor, request);
  }

  if (gameMatch !== null && request.method === 'DELETE') {
    const gameId = parseResourceId(gameMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.deleteGame(gameId));
  }
  if (summaryMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(summaryMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id);
    const details = await dependencies.games.getGame(gameId); const transactions = await dependencies.banking.listTransactions(gameId, 100);
    return success({ game: details.game, winners: calculateWinners(details.players), ...calculateFinalGameSummary(details.players, transactions) });
  }
  if (duplicateMatch !== null && request.method === 'POST') { const gameId = parseResourceId(duplicateMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.duplicateGameForOwner(actor.id, gameId, (await parseDuplicateGameRequest(request)).gameAccessPassword), 201); }
  if (finishMatch !== null && request.method === 'POST') { const gameId = parseResourceId(finishMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'FINISH_GAME', commandId: readCommandId(request) }); const details = await dependencies.games.finishGame(gameId); const winnerIds = new Set(calculateWinners(details.players).map((player) => player.id)); const participants = (await dependencies.access.linkedMembers(gameId)).filter((member) => member.playerId !== null).map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) })); await dependencies.profileStatistics.recordCompletedGame(gameId, participants); return success(details); }
  if (favoriteMatch !== null && request.method === 'POST') {
    const body = await request.json() as { amount?: unknown };
    if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount <= 0) throw new ApiValidationError('amount must be a positive integer.');
    const gameId = parseResourceId(favoriteMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(await dependencies.games.toggleFavoriteAmount(gameId, body.amount));
  }

  if (bankruptcyMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(bankruptcyMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const body = await parseBankruptcyRequest(request);
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'DECLARE_BANKRUPTCY', commandId: readCommandId(request), request: body });
    return success(await dependencies.banking.declareBankruptcy(gameId, body), 201);
  }

  if (transactionMatch !== null) {
    if (request.method === 'POST') {
      const gameId = parseResourceId(transactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id);
      const body = await parseCreateTransactionRequest(request);
      if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'CREATE_TRANSACTION', commandId: readCommandId(request), request: body });
      return success(await dependencies.banking.createTransaction(gameId, body), 201);
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

  throw new NotFoundError('NOT_FOUND', 'Endpoint not found.');
}

function readCommandId(request: Request): string {
  const commandId = request.headers.get('x-command-id');
  if (commandId === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(commandId)) throw new ApiValidationError('x-command-id must be a UUID v4.');
  return commandId;
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
  requestId: string,
  details?: Record<string, string | number>,
): Response {
  return Response.json({ error: { code, message, requestId, ...(details === undefined ? {} : { details }) } }, { status });
}

function readRequestId(request: Request): string {
  const candidate = request.headers.get('x-request-id');
  return candidate !== null && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(candidate) ? candidate : crypto.randomUUID();
}
