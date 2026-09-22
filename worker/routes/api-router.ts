import type { ApiSuccess, GameDetails } from '../../shared/contracts/api.js';
import type { PropertyOperation, TradeResolution } from '../../shared/contracts/live.js';
import type { BankingService } from '../services/banking-service.js';
import type { GameService } from '../services/game-service.js';
import { executePropertyOperation, resolveRentOwner, type PropertyService } from '../services/property-service.js';
import type { PropertyTradeService } from '../services/property-trade-service.js';
import type { BoardService } from '../services/board-service.js';
import { AuthService } from '../services/auth-service.js';
import { GameAccessService } from '../services/game-access-service.js';
import { ProfileStatisticsService } from '../services/profile-statistics-service.js';
import type { GameStatisticsRepository } from '../repositories/game-statistics-repository.js';
import type { GameLiveGateway } from '../services/game-live-gateway.js';
import { controlledPlayerIdForBankingCommand, rentBankingCommand } from '../../shared/domain/player-control.js';
import { ConflictError, InvalidJoinCodeError, NotFoundError, RateLimitError } from '../services/errors.js';
import { handleError } from '../services/error-handler.js';
import { requireSameOriginForMutation, requireSameOriginWebSocket, securityHeaders } from '../services/request-security.js';
import { securityEvent } from '../services/security-events.js';
import type { SecurityRateLimitRepository } from '../repositories/security-rate-limit-repository.js';
import type { OperationalMetrics } from '../services/operational-metrics.js';
import { tokenHash } from '../services/password-security.js';
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
  parseAuthTokenRequest,
  parseGuestJoinGameRequest,
  parsePasswordResetConfirmationRequest,
  parsePasswordResetRequest,
  parseUpgradeGuestRequest,
  parseAddAccountEmailRequest,
  parseFinishGameRequest,
  parseCatalogId,
  parseCreateBoardRequest,
  parseCreateTradeRequest,
  parseDiceRollRequest,
  parseJailBailRequest,
  parsePropertyBuildRequest,
  parsePropertyMortgageRequest,
  parsePropertyPurchaseRequest,
  parsePropertyRentRequest,
  parsePropertySellBuildingsRequest,
  parsePropertyUnmortgageRequest,
} from '../validation/api-validation.js';

export interface ApiRouterDependencies {
  games: GameService;
  banking: BankingService;
  auth: AuthService;
  access: GameAccessService;
  profileStatistics: ProfileStatisticsService;
  statistics?: GameStatisticsRepository;
  live?: GameLiveGateway;
  rateLimits?: SecurityRateLimitRepository;
  metrics?: OperationalMetrics;
  /** The board subsystem; a router without it answers its routes with `PROPERTIES_UNAVAILABLE`. */
  properties?: PropertyService;
  trades?: PropertyTradeService;
  boards?: BoardService;
}

export function createApiRouter(dependencies: ApiRouterDependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = readRequestId(request);
    const path = new URL(request.url).pathname;
    try {
      try { requireSameOriginForMutation(request); } catch (error) { securityEvent('csrf_rejected', { requestId }); throw error; }
      await enforceRateLimit(request, dependencies.rateLimits, requestId);
      const response = await route(request, dependencies, requestId);
      // Re-wrapping an HTTP 101 response drops Cloudflare's `webSocket` field.
      // Return the Durable Object response intact so the browser upgrade completes.
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      headers.set('x-request-id', requestId);
      securityHeaders(request, headers);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const response = handleError(error, { requestId, method: request.method, path, cloudflareRayId: request.headers.get('cf-ray') });
      const headers = new Headers(response.headers); securityHeaders(request, headers);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  };
}

async function route(request: Request, dependencies: ApiRouterDependencies, requestId: string): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const gameMatch = /^\/api\/games\/([^/]+)$/.exec(pathname);
  const transactionMatch = /^\/api\/games\/([^/]+)\/transactions$/.exec(pathname);
  const paymentRequestsMatch = /^\/api\/games\/([^/]+)\/payment-requests$/.exec(pathname);
  const paymentRequestActionMatch = /^\/api\/games\/([^/]+)\/payment-requests\/([^/]+)\/(accept|decline|cancel)$/.exec(pathname);
  const playerTransactionMatch = /^\/api\/games\/([^/]+)\/players\/([^/]+)\/transactions$/.exec(pathname);
  const duplicateMatch = /^\/api\/games\/([^/]+)\/duplicate$/.exec(pathname);
  const finishMatch = /^\/api\/games\/([^/]+)\/finish$/.exec(pathname);
  const startMatch = /^\/api\/games\/([^/]+)\/start$/.exec(pathname);
  const invitationMatch = /^\/api\/games\/([^/]+)\/invitations$/.exec(pathname);
  const favoriteMatch = /^\/api\/games\/([^/]+)\/favorite-amounts$/.exec(pathname);
  const bankruptcyMatch = /^\/api\/games\/([^/]+)\/bankruptcy$/.exec(pathname);
  const summaryMatch = /^\/api\/games\/([^/]+)\/summary$/.exec(pathname);
  const activityMatch = /^\/api\/games\/([^/]+)\/activity$/.exec(pathname);
  const liveMatch = /^\/api\/games\/([^/]+)\/live$/.exec(pathname);
  const boardMatch = /^\/api\/boards\/([^/]+)$/.exec(pathname);
  const propertiesMatch = /^\/api\/games\/([^/]+)\/properties$/.exec(pathname);
  const propertyOperationMatch = /^\/api\/games\/([^/]+)\/properties\/(purchase|rent|build|sell-buildings|mortgage|unmortgage)$/.exec(pathname);
  const tradesMatch = /^\/api\/games\/([^/]+)\/trades$/.exec(pathname);
  const tradeActionMatch = /^\/api\/games\/([^/]+)\/trades\/([^/]+)\/(accept|decline|cancel)$/.exec(pathname);
  const jailBailMatch = /^\/api\/games\/([^/]+)\/jail\/bail$/.exec(pathname);
  const diceRollsMatch = /^\/api\/games\/([^/]+)\/dice-rolls$/.exec(pathname);

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    const result = await dependencies.auth.register(await parseRegisterRequest(request));
    return success(result.profile, 201, result.cookie);
  }
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const result = await dependencies.auth.login(await parseLoginRequest(request));
    return success(result.profile, 200, result.cookie);
  }
  if (pathname === '/api/auth/verify-email' && request.method === 'POST') return success(await dependencies.auth.verifyEmail((await parseAuthTokenRequest(request)).token));
  if (pathname === '/api/auth/password-reset' && request.method === 'POST') { await dependencies.auth.requestPasswordReset((await parsePasswordResetRequest(request)).email); return success({ accepted: true }, 202); }
  if (pathname === '/api/auth/password-reset/confirm' && request.method === 'POST') { const body = await parsePasswordResetConfirmationRequest(request); await dependencies.auth.resetPassword(body.token, body.password); return success(null); }
  if (pathname === '/api/auth/logout' && request.method === 'POST') return success(null, 200, await dependencies.auth.logout(request));

  if (pathname === '/api/games/join/guest' && request.method === 'POST') {
    const body = await parseGuestJoinGameRequest(request);
    const access = 'invitationToken' in body
      ? await dependencies.access.invitation(body.invitationToken)
      : await joinCodeAccess(dependencies.access, body.joinCode, body.gameAccessPassword);
    if (access === null) throw new InvalidJoinCodeError();
    if (access.status !== 'LOBBY') throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
    const profile = await dependencies.auth.createGuest(body.nickname, body.avatar);
    const details = await dependencies.games.getGame(access.gameId);
    const playerId = crypto.randomUUID(); const color = nextPlayerColor(details.players);
    if (dependencies.live !== undefined) {
      const response = await dependencies.live.mutate(access.gameId, profile.profile, { type: 'JOIN_LOBBY', commandId: readCommandId(request), playerId, nickname: profile.profile.nickname, color, startingBalance: details.game.startingBalance });
      if (!response.ok) return response;
      const payload = await response.json() as { data: GameDetails };
      return success({ profile: profile.profile, game: payload.data }, 201, profile.cookie);
    }
    await dependencies.access.joinLobby({ gameId: access.gameId, userId: profile.profile.id, nickname: profile.profile.nickname, playerId, color, startingBalance: details.game.startingBalance });
    return success({ profile: profile.profile, game: await dependencies.games.getGame(access.gameId) }, 201, profile.cookie);
  }

  const actor = await dependencies.auth.current(request);
  if (pathname === '/api/auth/sessions/revoke-all' && request.method === 'POST') return success(null, 200, await dependencies.auth.revokeAll(actor.id));
  if (pathname === '/api/auth/upgrade' && request.method === 'POST') { const body = await parseUpgradeGuestRequest(request); const result = await dependencies.auth.upgradeGuest(actor.id, body.email, body.password); return success(result.profile, 200, result.cookie); }
  if (pathname === '/api/auth/email' && request.method === 'POST') return success(await dependencies.auth.addEmailToLegacyAccount(actor.id, (await parseAddAccountEmailRequest(request)).email));
  if (pathname === '/api/auth/verification-email' && request.method === 'POST') { await dependencies.auth.resendVerification(actor.id); return success({ accepted: true }, 202); }
  if (pathname === '/api/telemetry/pwa' && request.method === 'POST') {
    const body = await request.json() as { event?: unknown };
    if (body.event !== 'UPDATE_AVAILABLE' && body.event !== 'UPDATE_APPLIED' && body.event !== 'OFFLINE_SHELL') throw new ApiValidationError('Unsupported PWA telemetry event.');
    dependencies.metrics?.record('pwa', body.event.toLowerCase(), 'success', 0, 202);
    return success({ accepted: true }, 202);
  }
  if (pathname === '/api/profile') {
    if (request.method === 'GET') return success(actor);
    if (request.method === 'PATCH') { const body = await parseUpdateProfileRequest(request); return success(await dependencies.auth.update(actor.id, body.nickname, body.avatar)); }
  }
  if (pathname === '/api/games/join' && request.method === 'POST') {
    const body = await parseJoinGameRequest(request);
    const access = 'invitationToken' in body
      ? await dependencies.access.invitation(body.invitationToken)
      : await joinCodeAccess(dependencies.access, body.joinCode, body.gameAccessPassword);
    if (access === null) throw new InvalidJoinCodeError();
    if (access.status !== 'LOBBY') throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
    const details = await dependencies.games.getGame(access.gameId);
    const playerId = crypto.randomUUID(); const color = nextPlayerColor(details.players);
    if (dependencies.live !== undefined) return dependencies.live.mutate(access.gameId, actor, { type: 'JOIN_LOBBY', commandId: readCommandId(request), playerId, nickname: actor.nickname, color, startingBalance: details.game.startingBalance });
    await dependencies.access.joinLobby({ gameId: access.gameId, userId: actor.id, nickname: actor.nickname, playerId, color, startingBalance: details.game.startingBalance });
    return success(await dependencies.games.getGame(access.gameId));
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
    const controlledWallets = await dependencies.access.controlledWallets(gameId, actor.id);
    return success({ ...(await dependencies.games.getGame(gameId)), controlledWallets, controlledPlayerIds: controlledWallets.map((wallet) => wallet.playerId), canManage: role === 'OWNER', ...(role === 'OWNER' ? { joinCode: await dependencies.access.ownerJoinCode(gameId, actor.id) } : {}) });
  }

  if (liveMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(liveMatch[1], 'gameId');
    try { requireSameOriginWebSocket(request); } catch (error) { securityEvent('websocket_origin_rejected', { requestId, gameId }); throw error; }
    await dependencies.access.requireMember(gameId, actor.id);
    const details = await dependencies.games.getGame(gameId);
    if (details.game.status === 'FINISHED') return failure(409, 'GAME_FINISHED', 'This game is finished.', requestId);
    return dependencies.live === undefined ? failure(503, 'LIVE_UNAVAILABLE', 'Live games are not configured.', requestId) : dependencies.live.connect(gameId, actor, request);
  }

  if (gameMatch !== null && request.method === 'DELETE') {
    const gameId = parseResourceId(gameMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.deleteGame(gameId));
  }
  if (invitationMatch !== null && request.method === 'POST') { const gameId = parseResourceId(invitationMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.access.createInvitation(gameId, actor.id), 201); }
  if (invitationMatch !== null && request.method === 'DELETE') { const gameId = parseResourceId(invitationMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); await dependencies.access.revokeInvitations(gameId, actor.id); return success({ revoked: true }); }
  if (summaryMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(summaryMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id);
    const details = await dependencies.games.getGame(gameId);
    if (dependencies.statistics === undefined) throw new ConflictError('STATISTICS_UNAVAILABLE', 'Statistics are not configured.');
    const snapshot = details.game.status === 'FINISHED' ? await dependencies.statistics.getFinalSnapshot(gameId) : null;
    const summary = snapshot?.summary ?? await dependencies.statistics.calculate(details.game, details.players);
    const winners = (snapshot?.winnerPlayerIds ?? []).map((id) => details.players.find((player) => player.id === id)).filter((player): player is typeof details.players[number] => player !== undefined);
    return success({ game: details.game, winners, ...summary });
  }
  if (pathname === '/api/account/export' && request.method === 'GET') return success(await dependencies.auth.exportAccount(actor.id));
  if (pathname === '/api/account' && request.method === 'DELETE') return success(null, 200, await dependencies.auth.deleteAccount(actor.id));
  if (duplicateMatch !== null && request.method === 'POST') { const gameId = parseResourceId(duplicateMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); return success(await dependencies.games.duplicateGameForOwner(actor.id, gameId, (await parseDuplicateGameRequest(request)).gameAccessPassword), 201); }
  if (startMatch !== null && request.method === 'POST') { const gameId = parseResourceId(startMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'START_GAME', commandId: readCommandId(request) }); return success(await dependencies.games.startGame(gameId)); }
  if (finishMatch !== null && request.method === 'POST') { const gameId = parseResourceId(finishMatch[1], 'gameId'); await dependencies.access.requireOwner(gameId, actor.id); const body = await parseFinishGameRequest(request); const existing = await dependencies.games.getGame(gameId); if (body.winnerPlayerIds.some((id) => !existing.players.some((player) => player.id === id))) throw new ApiValidationError('winnerPlayerIds must belong to this game.'); if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'FINISH_GAME', commandId: readCommandId(request), winnerPlayerIds: body.winnerPlayerIds }); if (dependencies.statistics === undefined) throw new ConflictError('STATISTICS_UNAVAILABLE', 'Statistics are not configured.'); await dependencies.statistics.saveFinalSnapshot(gameId, body.winnerPlayerIds, await dependencies.statistics.calculate(existing.game, existing.players)); const details = await dependencies.games.finishGame(gameId); const winnerIds = new Set(body.winnerPlayerIds); const participants = (await dependencies.access.linkedMembers(gameId)).filter((member) => member.playerId !== null).map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) })); await dependencies.profileStatistics.recordCompletedGame(gameId, participants); return success(details); }
  if (activityMatch !== null && request.method === 'GET') { const gameId = parseResourceId(activityMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); if (dependencies.statistics === undefined) throw new ConflictError('STATISTICS_UNAVAILABLE', 'Statistics are not configured.'); const query = new URL(request.url).searchParams; const scope = query.get('scope') ?? 'ALL'; if (scope !== 'ALL' && scope !== 'MINE' && scope !== 'PENDING') throw new ApiValidationError('scope must be ALL, MINE, or PENDING.'); const limit = readHistoryLimit(request); const cursor = readActivityCursor(query.get('cursor')); const wallets = await dependencies.access.controlledWallets(gameId, actor.id); return success(scope === 'PENDING' ? await dependencies.statistics.pending(gameId, wallets.map((wallet) => wallet.playerId), cursor, limit) : await dependencies.statistics.activity(gameId, scope, wallets.map((wallet) => wallet.playerId), cursor, limit)); }
  if (favoriteMatch !== null && request.method === 'POST') {
    const body = await request.json() as { amount?: unknown };
    if (typeof body.amount !== 'number' || !Number.isSafeInteger(body.amount) || body.amount <= 0) throw new ApiValidationError('amount must be a positive integer.');
    const gameId = parseResourceId(favoriteMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); return success(await dependencies.games.toggleFavoriteAmount(gameId, body.amount));
  }

  if (bankruptcyMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(bankruptcyMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const body = await parseBankruptcyRequest(request);
    await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerIdForBankingCommand(body));
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'DECLARE_BANKRUPTCY', commandId: readCommandId(request), request: body });
    return success(await dependencies.banking.declareBankruptcy(gameId, body), 201);
  }

  if (transactionMatch !== null) {
    if (request.method === 'POST') {
      const gameId = parseResourceId(transactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id);
      const body = await parseCreateTransactionRequest(request);
      await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerIdForBankingCommand(body));
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

  if (paymentRequestsMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(paymentRequestsMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const wallets = await dependencies.access.controlledWallets(gameId, actor.id);
    return success(await dependencies.banking.listPaymentRequests(gameId, wallets.map((wallet) => wallet.playerId)));
  }

  if (paymentRequestActionMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(paymentRequestActionMatch[1], 'gameId');
    const paymentRequestId = parseResourceId(paymentRequestActionMatch[2], 'paymentRequestId');
    const action = paymentRequestActionMatch[3];
    await dependencies.access.requireMember(gameId, actor.id);
    const paymentRequest = await dependencies.banking.getPaymentRequest(gameId, paymentRequestId);
    if (paymentRequest === null) throw new NotFoundError('PAYMENT_REQUEST_NOT_FOUND', 'Payment request not found.');
    const controlledPlayerId = action === 'cancel' ? paymentRequest.creatorPlayerId : paymentRequest.approverPlayerId;
    await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerId);
    const commandId = readCommandId(request);
    if (dependencies.live !== undefined) {
      const type = action === 'accept' ? 'ACCEPT_PAYMENT_REQUEST' : action === 'decline' ? 'DECLINE_PAYMENT_REQUEST' : 'CANCEL_PAYMENT_REQUEST';
      return dependencies.live.mutate(gameId, actor, { type, commandId, paymentRequestId });
    }
    const result = action === 'accept'
      ? await dependencies.banking.acceptPaymentRequest(gameId, paymentRequestId)
      : action === 'decline'
        ? await dependencies.banking.declinePaymentRequest(gameId, paymentRequestId)
        : await dependencies.banking.cancelPaymentRequest(gameId, paymentRequestId);
    return success(result);
  }

  if (playerTransactionMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(playerTransactionMatch[1], 'gameId'); await dependencies.access.requireMember(gameId, actor.id); const playerId = parseResourceId(playerTransactionMatch[2], 'playerId'); await dependencies.access.requirePlayerController(gameId, actor.id, playerId); return success(
      await dependencies.banking.listPlayerTransactions(
        gameId,
        playerId,
        readHistoryLimit(request),
      ),
    );
  }

  if (pathname === '/api/boards') {
    const boards = requireBoards(dependencies);
    if (request.method === 'GET') return success(await boards.list(actor.id));
    if (request.method === 'POST') return success(await boards.create(actor.id, await parseCreateBoardRequest(request)), 201);
  }
  if (boardMatch !== null) {
    const boards = requireBoards(dependencies);
    const boardId = parseCatalogId(boardMatch[1], 'boardId');
    if (request.method === 'GET') return success(await boards.get(boardId, actor.id));
    if (request.method === 'DELETE') return success(await boards.delete(boardId, actor.id));
  }

  if (propertiesMatch !== null && request.method === 'GET') {
    const gameId = parseResourceId(propertiesMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    return success(await requireProperties(dependencies).state(gameId));
  }

  if (propertyOperationMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(propertyOperationMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const properties = requireProperties(dependencies);
    const command = await parsePropertyOperation(request, propertyOperationMatch[2]);
    // Rent authority comes from the stored deed, never from the request body.
    const authorized = command.operation === 'RENT' ? rentBankingCommand(command.request, await resolveRentOwner(properties, gameId, command.request)) : command.request;
    await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerIdForBankingCommand(authorized));
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'PROPERTY_OPERATION', commandId: readCommandId(request), ...command });
    return success(await executePropertyOperation(properties, gameId, command), 201);
  }

  if (tradesMatch !== null) {
    const gameId = parseResourceId(tradesMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const trades = requireTrades(dependencies);
    if (request.method === 'GET') return success(await trades.list(gameId));
    if (request.method === 'POST') {
      const body = await parseCreateTradeRequest(request);
      await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerIdForBankingCommand(body));
      if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'PROPOSE_TRADE', commandId: readCommandId(request), request: body });
      return success(await trades.propose(gameId, body), 201);
    }
  }

  if (tradeActionMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(tradeActionMatch[1], 'gameId');
    const tradeId = parseResourceId(tradeActionMatch[2], 'tradeId');
    const action = tradeActionMatch[3] as TradeResolution;
    await dependencies.access.requireMember(gameId, actor.id);
    const trades = requireTrades(dependencies);
    const trade = await trades.get(gameId, tradeId);
    if (trade === null) throw new NotFoundError('TRADE_NOT_FOUND', 'Trade not found.');
    await dependencies.access.requirePlayerController(gameId, actor.id, action === 'cancel' ? trade.proposerPlayerId : trade.responderPlayerId);
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'RESOLVE_TRADE', commandId: readCommandId(request), tradeId, action });
    return success(action === 'accept' ? await trades.accept(gameId, tradeId) : action === 'decline' ? await trades.decline(gameId, tradeId) : await trades.cancel(gameId, tradeId));
  }

  if (jailBailMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(jailBailMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const properties = requireProperties(dependencies);
    const body = await parseJailBailRequest(request);
    await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerIdForBankingCommand(body));
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'JAIL_BAIL', commandId: readCommandId(request), request: body });
    return success(await properties.payJailBail(gameId, body), 201);
  }

  if (diceRollsMatch !== null && request.method === 'POST') {
    const gameId = parseResourceId(diceRollsMatch[1], 'gameId');
    await dependencies.access.requireMember(gameId, actor.id);
    const properties = requireProperties(dependencies);
    const body = await parseDiceRollRequest(request);
    await dependencies.access.requirePlayerController(gameId, actor.id, body.playerId);
    if (dependencies.live !== undefined) return dependencies.live.mutate(gameId, actor, { type: 'DICE_ROLL', commandId: readCommandId(request), request: body });
    return success(await properties.recordDiceRoll(gameId, body), 201);
  }

  throw new NotFoundError('NOT_FOUND', 'Endpoint not found.');
}

async function parsePropertyOperation(request: Request, action: string): Promise<PropertyOperation> {
  switch (action) {
    case 'purchase': return { operation: 'PURCHASE', request: await parsePropertyPurchaseRequest(request) };
    case 'rent': return { operation: 'RENT', request: await parsePropertyRentRequest(request) };
    case 'build': return { operation: 'BUILD', request: await parsePropertyBuildRequest(request) };
    case 'sell-buildings': return { operation: 'SELL_BUILDINGS', request: await parsePropertySellBuildingsRequest(request) };
    case 'mortgage': return { operation: 'MORTGAGE', request: await parsePropertyMortgageRequest(request) };
    default: return { operation: 'UNMORTGAGE', request: await parsePropertyUnmortgageRequest(request) };
  }
}

function requireProperties(dependencies: ApiRouterDependencies): PropertyService {
  if (dependencies.properties === undefined) throw new ConflictError('PROPERTIES_UNAVAILABLE', 'Property operations are not configured.');
  return dependencies.properties;
}
function requireTrades(dependencies: ApiRouterDependencies): PropertyTradeService {
  if (dependencies.trades === undefined) throw new ConflictError('PROPERTIES_UNAVAILABLE', 'Property trades are not configured.');
  return dependencies.trades;
}
function requireBoards(dependencies: ApiRouterDependencies): BoardService {
  if (dependencies.boards === undefined) throw new ConflictError('PROPERTIES_UNAVAILABLE', 'Boards are not configured.');
  return dependencies.boards;
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
function readActivityCursor(value: string | null): { createdAt: string; id: string } | null { if (value === null) return null; try { const parsed: unknown = JSON.parse(atob(value)); if (parsed === null || typeof parsed !== 'object' || typeof (parsed as { createdAt?: unknown }).createdAt !== 'string' || !/^[0-9a-f-]{36}$/iu.test(String((parsed as { id?: unknown }).id))) throw new Error(); return { createdAt: (parsed as { createdAt: string }).createdAt, id: String((parsed as { id: string }).id) }; } catch { throw new ApiValidationError('cursor is invalid.'); } }

function success<T>(data: T, status = 200, cookie?: string): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, { status, ...(cookie === undefined ? {} : { headers: { 'set-cookie': cookie } }) });
}

async function enforceRateLimit(request: Request, repository: SecurityRateLimitRepository | undefined, requestId: string): Promise<void> {
  if (repository === undefined) return;
  const pathname = new URL(request.url).pathname;
  const rule = pathname === '/api/auth/login' || pathname === '/api/auth/register' ? { category: 'auth', limit: 10, seconds: 600 }
    : pathname === '/api/auth/password-reset' || pathname === '/api/auth/verification-email' ? { category: 'email', limit: 5, seconds: 3600 }
      : pathname === '/api/games/join/guest' ? { category: 'guest-join', limit: 12, seconds: 600 }
        : /^\/api\/games\/[^/]+\/invitations$/.test(pathname) && request.method === 'POST' ? { category: 'invite', limit: 12, seconds: 3600 }
          : undefined;
  if (rule === undefined) return;
  const source = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const bucket = `${rule.category}:${await tokenHash(source)}`;
  if (await repository.take(bucket, rule.limit, rule.seconds)) return;
  securityEvent('rate_limited', { requestId });
  throw new RateLimitError();
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

function nextPlayerColor(players: readonly { color: string }[]): string {
  const colors = ['#e05263', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#14b8a6'];
  return colors.find((color) => !players.some((player) => player.color === color)) ?? colors[players.length % colors.length];
}

async function joinCodeAccess(access: GameAccessService, joinCode: string, gameAccessPassword: string | undefined): Promise<{ gameId: string; status: string } | null> {
  const credentials = await access.getJoinCredentials(joinCode);
  if (credentials === null || !(await access.verifyGamePassword(gameAccessPassword, credentials))) return null;
  return { gameId: credentials.gameId, status: credentials.status };
}
