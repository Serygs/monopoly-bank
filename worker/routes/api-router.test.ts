import { describe, expect, it, vi } from 'vitest';

import type { CreateGameRequest, CreateTransactionRequest, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import { IncompleteEstateError, InsufficientFundsError } from '../../shared/domain/banking.js';
import { PlayerNotInJailError } from '../../shared/domain/jail.js';
import { DiceTotalRequiredError, IncompleteColorGroupError, PropertyAlreadyOwnedError } from '../../shared/domain/property.js';
import { MortgageResolutionRequiredError, TradeStateChangedError } from '../../shared/domain/property-trade.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { BankingService } from '../services/banking-service.js';
import { BoardRequiredError, ConflictError, ForbiddenError, ResourceNotFoundError } from '../services/errors.js';
import type { GameService } from '../services/game-service.js';
import { createApiRouter } from './api-router.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const firstPlayerId = '00000000-0000-4000-8000-000000000002';
const secondPlayerId = '00000000-0000-4000-8000-000000000003';

const gameDetails: GameDetails = {
  game: {
    id: gameId,
    name: 'Friday Monopoly',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'K',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  players: [
    { id: firstPlayerId, gameId, name: 'Ada', color: '#123456', balance: 1500, createdAt: '2026-01-01T00:00:00Z' },
    { id: secondPlayerId, gameId, name: 'Lin', color: '#654321', balance: 1500, createdAt: '2026-01-01T00:00:00Z' },
  ],
};

describe('API router', () => {
  it('rejects cross-origin mutations before a service can write and attaches security headers', async () => {
    let writes = 0;
    const router = createTestRouter({ createGame: async () => { writes += 1; return gameDetails; } });
    const response = await router(new Request('https://example.test/api/games', { method: 'POST', headers: { origin: 'https://attacker.test', 'content-type': 'application/json' }, body: JSON.stringify({}) }));
    expect(response.status).toBe(403);
    expect(writes).toBe(0);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
  it('uses the same generic response for known and unknown password-reset requests', async () => {
    const requestedEmails: string[] = [];
    const router = createApiRouter({
      games: {} as GameService,
      banking: {} as BankingService,
      auth: { requestPasswordReset: async (email: string) => { requestedEmails.push(email); } } as never,
      access: {} as never,
      profileStatistics: {} as never,
    });

    const known = await router(jsonRequest('POST', '/api/auth/password-reset', { email: 'known@example.test' }));
    const unknown = await router(jsonRequest('POST', '/api/auth/password-reset', { email: 'unknown@example.test' }));

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    await expect(known.json()).resolves.toEqual({ data: { accepted: true } });
    await expect(unknown.json()).resolves.toEqual({ data: { accepted: true } });
    expect(requestedEmails).toEqual(['known@example.test', 'unknown@example.test']);
  });

  it('creates a valid game with server-validated input', async () => {
    let received: CreateGameRequest | undefined;
    const router = createTestRouter({
      createGame: async (request) => {
        received = request;
        return gameDetails;
      },
    });

    const response = await router(jsonRequest('POST', '/api/games', {
      name: ' Friday Monopoly ',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      gameAccessPassword: 'table-password',
      players: [
        { name: ' Ada ', color: '#123456' },
        { name: 'Lin', color: '#654321' },
      ],
    }));

    expect(response.status).toBe(201);
    expect(received).toEqual({
      name: 'Friday Monopoly',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      gameAccessPassword: 'table-password',
      players: [
        { name: 'Ada', color: '#123456' },
        { name: 'Lin', color: '#654321' },
      ],
    });
  });

  it.each([
    [{ name: 'Only', color: '#123456' },],
    Array.from({ length: 7 }, (_, index) => ({ name: `Player ${index}`, color: '#123456' })),
  ])('rejects an invalid player count', async (players) => {
    const response = await createTestRouter()(jsonRequest('POST', '/api/games', {
      name: 'Friday Monopoly',
      startingBalance: 1500,
      passGoReward: 200,
      players,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it.each(['startingBalance', 'passGoReward'])('rejects invalid %s', async (field) => {
    const response = await createTestRouter()(jsonRequest('POST', '/api/games', {
      name: 'Friday Monopoly',
      startingBalance: field === 'startingBalance' ? 0 : 1500,
      passGoReward: field === 'passGoReward' ? -1 : 200,
      currency: 'USD',
      players: [
        { name: 'Ada', color: '#123456' },
        { name: 'Lin', color: '#654321' },
      ],
    }));

    expect(response.status).toBe(400);
  });

  it('rejects an unsupported game currency', async () => {
    const response = await createTestRouter()(jsonRequest('POST', '/api/games', {
      name: 'Friday Monopoly',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'GBP',
      gameAccessPassword: 'table-password',
      players: [{ name: 'Ada', color: '#123456' }, { name: 'Lin', color: '#654321' }],
    }));

    expect(response.status).toBe(400);
  });

  it('accepts a valid payment request', async () => {
    let received: CreateTransactionRequest | undefined;
    const router = createTestRouter({
      createTransaction: async (_gameId, request) => {
        received = request;
        return transactionResponse();
      },
    });

    const response = await router(jsonRequest('POST', `/api/games/${gameId}/transactions`, {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: firstPlayerId,
      destinationPlayerId: secondPlayerId,
      amount: 100,
    }));

    expect(response.status).toBe(201);
    expect(received).toMatchObject({ type: 'PLAYER_TO_PLAYER', amount: 100 });
  });

  it('rejects a direct transaction for a foreign wallet before any banking service call', async () => {
    let writes = 0;
    let liveMutations = 0;
    const router = createApiRouter({
      games: {} as GameService,
      banking: { createTransaction: async () => { writes += 1; return transactionResponse(); } } as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Member', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { requireMember: async () => 'OWNER', requirePlayerController: async () => { throw new ForbiddenError(); } } as never,
      profileStatistics: {} as never,
      live: { connect: async () => new Response(), mutate: async () => { liveMutations += 1; return new Response(); } },
    });

    const response = await router(jsonRequest('POST', `/api/games/${gameId}/transactions`, { type: 'PLAYER_TO_BANK', playerId: secondPlayerId, amount: 100 }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this operation.', requestId: expect.any(String) } });
    expect(writes).toBe(0);
    expect(liveMutations).toBe(0);
  });

  it('rejects retired PAY_RENT creation requests', async () => {
    const response = await createTestRouter()(jsonRequest('POST', `/api/games/${gameId}/transactions`, {
      type: 'PAY_RENT',
      sourcePlayerId: firstPlayerId,
      destinationPlayerId: secondPlayerId,
      amount: 100,
    }));

    expect(response.status).toBe(400);
  });

  it('rejects malformed player IDs in a payment request', async () => {
    const response = await createTestRouter()(jsonRequest('POST', `/api/games/${gameId}/transactions`, {
      type: 'PLAYER_TO_BANK',
      playerId: 'not-a-uuid',
      amount: 100,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'playerId must be a UUID.' },
    });
  });

  it.each([
    ['PLAYER_TO_ALL', { payerPlayerId: firstPlayerId, amountPerPlayer: 100 }],
    ['ALL_TO_PLAYER', { recipientPlayerId: firstPlayerId, amountPerPlayer: 100 }],
  ] as const)('returns atomic insufficient-funds failure for %s', async (type, fields) => {
    const router = createTestRouter({
      createTransaction: async () => {
        throw new InsufficientFundsError(firstPlayerId, 50, 200);
      },
    });

    const response = await router(jsonRequest('POST', `/api/games/${gameId}/transactions`, { type, ...fields }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Player does not have enough funds.',
        requestId: expect.any(String),
        details: { playerId: firstPlayerId, currentBalance: 50, requiredAmount: 200, shortfall: 150 },
      },
    });
  });

  it('returns 404 for a missing game', async () => {
    const router = createTestRouter({
      getGame: async () => {
        throw new ResourceNotFoundError('Game');
      },
    });

    const response = await router(new Request(`https://example.test/api/games/${gameId}`));
    expect(response.status).toBe(404);
  });

  it('does not expose an unowned legacy game through a normal authenticated API', async () => {
    const games: GameService = { listGames: async () => [], listGamesForUser: async () => [], createGame: async () => gameDetails, createGameForOwner: async () => gameDetails, getGame: async () => gameDetails, deleteGame: async () => ({ gameId }), duplicateGame: async () => gameDetails, finishGame: async () => gameDetails, toggleFavoriteAmount: async () => [] };
    const banking: BankingService = { createTransaction: async () => transactionResponse(), listTransactions: async () => [], listPlayerTransactions: async () => [] };
    const router = createApiRouter({ games, banking, auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Test', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never, access: { requireMember: async () => { throw new ResourceNotFoundError('Game'); }, controlledWallets: async () => [] } as never, profileStatistics: { recordCompletedGame: async () => undefined } as never });
    const response = await router(new Request(`https://example.test/api/games/${gameId}`));
    expect(response.status).toBe(404);
  });

  it('exposes an invitation code only to the game owner', async () => {
    const games: GameService = { listGames: async () => [], listGamesForUser: async () => [], createGameForOwner: async () => gameDetails, getGame: async () => gameDetails, deleteGame: async () => ({ gameId }), duplicateGameForOwner: async () => gameDetails, finishGame: async () => gameDetails, toggleFavoriteAmount: async () => [] };
    const banking: BankingService = { createTransaction: async () => transactionResponse(), listTransactions: async () => [], listPlayerTransactions: async () => [] };
    const router = createApiRouter({ games, banking, auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Owner', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never, access: { requireMember: async () => 'OWNER', ownerJoinCode: async () => 'TABLE42', controlledWallets: async () => [] } as never, profileStatistics: { recordCompletedGame: async () => undefined } as never });

    const response = await router(new Request(`https://example.test/api/games/${gameId}`));

    await expect(response.json()).resolves.toMatchObject({ data: { canManage: true, joinCode: 'TABLE42' } });
  });

  it('does not expose an invitation code to a player member', async () => {
    const response = await createTestRouter()(new Request(`https://example.test/api/games/${gameId}`));

    await expect(response.json()).resolves.toEqual({ data: { ...gameDetails, controlledWallets: [], controlledPlayerIds: [], canManage: false } });
  });

  it('creates a secure lobby invitation only through the owner route', async () => {
    let invitationInput: { gameId: string; userId: string } | undefined;
    const router = createApiRouter({
      games: {} as GameService,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Owner', avatar: '🎩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { requireOwner: async (requestedGameId: string) => { invitationInput = { gameId: requestedGameId, userId: '00000000-0000-4000-8000-000000000099' }; }, createInvitation: async () => ({ invitationToken: 'secure-token', shortCode: 'TABLE42', expiresAt: '2026-02-01T00:00:00.000Z', visibility: 'UNLISTED' }) } as never,
      profileStatistics: { recordCompletedGame: async () => undefined } as never,
    });

    const response = await router(new Request(`https://example.test/api/games/${gameId}/invitations`, { method: 'POST' }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { invitationToken: 'secure-token', shortCode: 'TABLE42', expiresAt: '2026-02-01T00:00:00.000Z', visibility: 'UNLISTED' } });
    expect(invitationInput).toEqual({ gameId, userId: '00000000-0000-4000-8000-000000000099' });
  });

  it('does not distinguish expired or revoked invitation tokens from an invalid token', async () => {
    const router = createApiRouter({
      games: {} as GameService,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Member', avatar: '🎩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { invitation: async () => null } as never,
      profileStatistics: {} as never,
    });
    const response = await router(jsonRequest('POST', '/api/games/join', { invitationToken: 'A'.repeat(43) }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_JOIN_CODE' } });
  });

  it('preserves the Durable Object WebSocket upgrade response', async () => {
    const upgrade = { status: 101, headers: new Headers({ 'x-request-id': 'live-request-id' }), body: null, statusText: '' } as Response;
    const router = createApiRouter({
      games: { getGame: async () => gameDetails } as never,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Member', avatar: '🎩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { requireMember: async () => 'PLAYER' } as never,
      profileStatistics: {} as never,
      live: { connect: async () => upgrade, mutate: async () => new Response() },
    });

    await expect(router(new Request(`https://example.test/api/games/${gameId}/live`, { headers: { upgrade: 'websocket' } }))).resolves.toBe(upgrade);
  });

  it('creates a secure lobby invitation only through the owner route', async () => {
    let invitationInput: { gameId: string; userId: string } | undefined;
    const router = createApiRouter({
      games: {} as GameService,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Owner', avatar: '🎩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { requireOwner: async (requestedGameId: string) => { invitationInput = { gameId: requestedGameId, userId: '00000000-0000-4000-8000-000000000099' }; }, createInvitation: async () => ({ invitationToken: 'secure-token', shortCode: 'TABLE42', expiresAt: '2026-02-01T00:00:00.000Z', visibility: 'UNLISTED' }) } as never,
      profileStatistics: { recordCompletedGame: async () => undefined } as never,
    });

    const response = await router(new Request(`https://example.test/api/games/${gameId}/invitations`, { method: 'POST' }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { invitationToken: 'secure-token', shortCode: 'TABLE42', expiresAt: '2026-02-01T00:00:00.000Z', visibility: 'UNLISTED' } });
    expect(invitationInput).toEqual({ gameId, userId: '00000000-0000-4000-8000-000000000099' });
  });

  it('preserves the Durable Object WebSocket upgrade response', async () => {
    const upgrade = { status: 101, headers: new Headers({ 'x-request-id': 'live-request-id' }), body: null, statusText: '' } as Response;
    const router = createApiRouter({
      games: { getGame: async () => gameDetails } as never,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Member', avatar: '🎩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: { requireMember: async () => 'PLAYER' } as never,
      profileStatistics: {} as never,
      live: { connect: async () => upgrade, mutate: async () => new Response() },
    });

    await expect(router(new Request(`https://example.test/api/games/${gameId}/live`, { headers: { upgrade: 'websocket' } }))).resolves.toBe(upgrade);
  });

  it('deletes a saved game', async () => {
    let deletedGameId: string | undefined;
    const router = createTestRouter({
      deleteGame: async (requestedGameId) => {
        deletedGameId = requestedGameId;
        return { gameId: requestedGameId };
      },
    });

    const response = await router(new Request(`https://example.test/api/games/${gameId}`, {
      method: 'DELETE',
    }));

    expect(response.status).toBe(200);
    expect(deletedGameId).toBe(gameId);
    await expect(response.json()).resolves.toEqual({ data: { gameId } });
  });

  it('returns 404 for a missing player history', async () => {
    const router = createTestRouter({
      listPlayerTransactions: async () => {
        throw new ResourceNotFoundError('Player');
      },
    });

    const response = await router(new Request(`https://example.test/api/games/${gameId}/players/${firstPlayerId}/transactions`));
    expect(response.status).toBe(404);
  });

  it('returns game transaction history', async () => {
    const history: Transaction[] = [transactionResponse().transaction];
    const router = createTestRouter({ listTransactions: async () => history });

    const response = await router(new Request(`https://example.test/api/games/${gameId}/transactions`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: history });
  });

  it('rejects malformed resource IDs before calling a service', async () => {
    const response = await createTestRouter()(new Request('https://example.test/api/games/not-a-uuid'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'gameId must be a UUID.' },
    });
  });
});

describe('board and property routes', () => {
  const boardSpaceId = 'board-classic-space-01';
  const tradeId = '00000000-0000-4000-8000-000000000077';
  const commandId = '00000000-0000-4000-8000-000000000088';
  const ownerId = '00000000-0000-4000-8000-000000000099';
  const spaceNames = Object.fromEntries(Array.from({ length: 28 }, (_, index) => [`board-classic-space-${String(index).padStart(2, '0')}`, `Street ${index}`]));

  it('passes a boardId through to game creation', async () => {
    let received: CreateGameRequest | undefined;
    const router = createTestRouter({ createGame: async (request) => { received = request; return gameDetails; } });
    const response = await router(jsonRequest('POST', '/api/games', { name: 'Board table', startingBalance: 1500, passGoReward: 200, currency: 'USD', boardId: 'board-classic', players: [{ name: 'Ada', color: '#123456' }] }));
    expect(response.status).toBe(201);
    expect(received?.boardId).toBe('board-classic');
  });

  it('returns the board slice to a member and refuses a game without a board with BOARD_REQUIRED', async () => {
    const { router, properties } = createPropertyRouter();
    const response = await router(new Request(`https://example.test/api/games/${gameId}/properties`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { properties: [{ boardSpaceId, ownerPlayerId: secondPlayerId }] } });
    properties.state.mockRejectedValueOnce(new BoardRequiredError());
    const legacy = await router(new Request(`https://example.test/api/games/${gameId}/properties`));
    expect(legacy.status).toBe(400);
    await expect(legacy.json()).resolves.toMatchObject({ error: { code: 'BOARD_REQUIRED' } });
  });

  it('buys a deed for a controlled wallet and answers 201 with the operation result', async () => {
    const { router, properties } = createPropertyRouter();
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/properties/purchase`, { playerId: firstPlayerId, boardSpaceId }));
    expect(response.status).toBe(201);
    expect(properties.purchase).toHaveBeenCalledWith(gameId, { playerId: firstPlayerId, boardSpaceId });
    await expect(response.json()).resolves.toMatchObject({ data: { transaction: { type: 'PROPERTY_PURCHASE' } } });
  });

  it('rejects a purchase from a wallet the actor does not control before any service call', async () => {
    const { router, properties, live } = createPropertyRouter({ controlled: [firstPlayerId], live: true });
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/properties/purchase`, { playerId: secondPlayerId, boardSpaceId }));
    expect(response.status).toBe(403);
    expect(properties.purchase).not.toHaveBeenCalled();
    expect(live.mutate).not.toHaveBeenCalled();
  });

  it('answers 400 PROPERTY_NOT_OWNED for rent on a deed nobody owns, without touching the service', async () => {
    const { router, properties } = createPropertyRouter({ owner: null });
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/properties/rent`, { payerPlayerId: firstPlayerId, boardSpaceId, chargedByOwner: true }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PROPERTY_NOT_OWNED', details: { boardSpaceId } } });
    expect(properties.chargeRent).not.toHaveBeenCalled();
  });

  it('authorizes an owner-raised rent claim against the stored owner and a payer-raised one against the payer', async () => {
    const claimed = createPropertyRouter({ owner: secondPlayerId, controlled: [secondPlayerId] });
    const claim = await claimed.router(jsonRequest('POST', `/api/games/${gameId}/properties/rent`, { payerPlayerId: firstPlayerId, boardSpaceId, chargedByOwner: true, ownerPlayerId: firstPlayerId }));
    expect(claim.status).toBe(201);
    expect(claimed.controllers).toEqual([secondPlayerId]);
    expect(claimed.properties.chargeRent).toHaveBeenCalledWith(gameId, { payerPlayerId: firstPlayerId, boardSpaceId, chargedByOwner: true });

    const paid = createPropertyRouter({ owner: secondPlayerId, controlled: [secondPlayerId] });
    const payment = await paid.router(jsonRequest('POST', `/api/games/${gameId}/properties/rent`, { payerPlayerId: firstPlayerId, boardSpaceId }));
    expect(payment.status).toBe(403);
    expect(paid.controllers).toEqual([firstPlayerId]);
    expect(paid.properties.chargeRent).not.toHaveBeenCalled();
  });

  it('records an auction for the winner\'s controller at a bid above the catalogue price, and rejects a zero bid before any service call', async () => {
    const { router, properties, controllers } = createPropertyRouter({ controlled: [secondPlayerId] });
    properties.recordAuction.mockResolvedValueOnce({ transaction: { ...transactionResponse().transaction, type: 'PROPERTY_AUCTION' as const, amount: 999, totalAmount: 999 }, players: gameDetails.players, properties: [{ boardSpaceId, ownerPlayerId: secondPlayerId, houses: 0, mortgaged: false }], buildingBank: { housesAvailable: 32, hotelsAvailable: 12 } });
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/properties/auction`, { winnerPlayerId: secondPlayerId, boardSpaceId, price: 999 }));
    expect(response.status).toBe(201);
    expect(controllers).toEqual([secondPlayerId]);
    expect(properties.recordAuction).toHaveBeenCalledWith(gameId, { winnerPlayerId: secondPlayerId, boardSpaceId, price: 999 });
    await expect(response.json()).resolves.toMatchObject({ data: { transaction: { type: 'PROPERTY_AUCTION', amount: 999 } } });

    const zero = await router(jsonRequest('POST', `/api/games/${gameId}/properties/auction`, { winnerPlayerId: secondPlayerId, boardSpaceId, price: 0 }));
    expect(zero.status).toBe(400);
    await expect(zero.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR', message: 'price must be a positive integer.' } });
    expect(properties.recordAuction).toHaveBeenCalledTimes(1);
  });

  it('answers PROPERTY_ALREADY_OWNED for an auction of a held deed and refuses a bid for a wallet the actor does not control', async () => {
    const { router, properties } = createPropertyRouter();
    properties.recordAuction.mockRejectedValueOnce(new PropertyAlreadyOwnedError(boardSpaceId, firstPlayerId));
    const held = await router(jsonRequest('POST', `/api/games/${gameId}/properties/auction`, { winnerPlayerId: secondPlayerId, boardSpaceId, price: 120 }));
    expect(held.status).toBe(409);
    await expect(held.json()).resolves.toMatchObject({ error: { code: 'PROPERTY_ALREADY_OWNED', details: { boardSpaceId } } });

    const foreign = createPropertyRouter({ controlled: [firstPlayerId], live: true });
    const response = await foreign.router(jsonRequest('POST', `/api/games/${gameId}/properties/auction`, { winnerPlayerId: secondPlayerId, boardSpaceId, price: 120 }));
    expect(response.status).toBe(403);
    expect(foreign.properties.recordAuction).not.toHaveBeenCalled();
    expect(foreign.live.mutate).not.toHaveBeenCalled();
  });

  it('routes every property operation through the live coordinator as a PROPERTY_OPERATION command', async () => {
    const { router, live, properties } = createPropertyRouter({ live: true });
    const headers = { 'content-type': 'application/json', 'x-command-id': commandId };
    for (const [action, operation, body] of [
      ['purchase', 'PURCHASE', { playerId: firstPlayerId, boardSpaceId }],
      ['build', 'BUILD', { playerId: firstPlayerId, boardSpaceId, count: 2 }],
      ['sell-buildings', 'SELL_BUILDINGS', { playerId: firstPlayerId, boardSpaceId, count: 1 }],
      ['mortgage', 'MORTGAGE', { playerId: firstPlayerId, boardSpaceId }],
      ['unmortgage', 'UNMORTGAGE', { playerId: firstPlayerId, boardSpaceId }],
      ['auction', 'AUCTION', { winnerPlayerId: firstPlayerId, boardSpaceId, price: 75 }],
    ] as const) {
      await router(new Request(`https://example.test/api/games/${gameId}/properties/${action}`, { method: 'POST', headers, body: JSON.stringify(body) }));
      expect(live.mutate).toHaveBeenLastCalledWith(gameId, expect.anything(), { type: 'PROPERTY_OPERATION', commandId, operation, request: body });
    }
    expect(properties.purchase).not.toHaveBeenCalled();
    const missing = await router(jsonRequest('POST', `/api/games/${gameId}/properties/purchase`, { playerId: firstPlayerId, boardSpaceId }));
    expect(missing.status).toBe(400);
  });

  it.each([
    ['PROPERTY_ALREADY_OWNED', 409, () => new PropertyAlreadyOwnedError(boardSpaceId, secondPlayerId)],
    ['INCOMPLETE_COLOR_GROUP', 409, () => new IncompleteColorGroupError('BROWN')],
    ['TRADE_STATE_CHANGED', 409, () => new TradeStateChangedError(boardSpaceId, { ownerPlayerId: firstPlayerId, houses: 0, mortgaged: false }, { ownerPlayerId: firstPlayerId, houses: 0, mortgaged: true })],
    ['MORTGAGE_RESOLUTION_REQUIRED', 400, () => new MortgageResolutionRequiredError(boardSpaceId)],
    ['PLAYER_NOT_IN_JAIL', 409, () => new PlayerNotInJailError(firstPlayerId)],
    ['INSUFFICIENT_FUNDS', 409, () => new InsufficientFundsError(firstPlayerId, 10, 60)],
    ['INCOMPLETE_ESTATE', 400, () => new IncompleteEstateError(['properties'])],
    ['DICE_TOTAL_REQUIRED', 400, () => new DiceTotalRequiredError(boardSpaceId)],
  ] as const)('returns the domain code %s with the domain status %i', async (code, status, error) => {
    const { router, properties } = createPropertyRouter();
    properties.purchase.mockRejectedValueOnce(error());
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/properties/purchase`, { playerId: firstPlayerId, boardSpaceId }));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it('proposes a trade for the proposer\'s controller and lists trades for members', async () => {
    const { router, trades, controllers } = createPropertyRouter();
    const body = { proposerPlayerId: firstPlayerId, responderPlayerId: secondPlayerId, cashFromProposer: 50, propertiesFromProposer: [{ boardSpaceId }] };
    const response = await router(jsonRequest('POST', `/api/games/${gameId}/trades`, body));
    expect(response.status).toBe(201);
    expect(controllers).toEqual([firstPlayerId]);
    expect(trades.propose).toHaveBeenCalledWith(gameId, body);
    const list = await router(new Request(`https://example.test/api/games/${gameId}/trades`));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ data: [expect.objectContaining({ id: tradeId })] });
  });

  it('lets only the responder accept or decline and only the proposer cancel a trade', async () => {
    const responder = createPropertyRouter({ controlled: [secondPlayerId] });
    expect((await responder.router(jsonRequest('POST', `/api/games/${gameId}/trades/${tradeId}/accept`, {}))).status).toBe(200);
    expect(responder.trades.accept).toHaveBeenCalledWith(gameId, tradeId);
    expect((await responder.router(jsonRequest('POST', `/api/games/${gameId}/trades/${tradeId}/cancel`, {}))).status).toBe(403);
    expect(responder.trades.cancel).not.toHaveBeenCalled();

    const proposer = createPropertyRouter({ controlled: [firstPlayerId] });
    expect((await proposer.router(jsonRequest('POST', `/api/games/${gameId}/trades/${tradeId}/accept`, {}))).status).toBe(403);
    expect(proposer.trades.accept).not.toHaveBeenCalled();
    expect((await proposer.router(jsonRequest('POST', `/api/games/${gameId}/trades/${tradeId}/cancel`, {}))).status).toBe(200);
    expect(proposer.trades.cancel).toHaveBeenCalledWith(gameId, tradeId);

    const missing = createPropertyRouter({ trade: null });
    expect((await missing.router(jsonRequest('POST', `/api/games/${gameId}/trades/${tradeId}/decline`, {}))).status).toBe(404);
  });

  it('pays bail and records dice rolls for the wallet\'s controller only', async () => {
    const { router, properties, controllers } = createPropertyRouter();
    expect((await router(jsonRequest('POST', `/api/games/${gameId}/jail/bail`, { playerId: firstPlayerId }))).status).toBe(201);
    expect(properties.payJailBail).toHaveBeenCalledWith(gameId, { playerId: firstPlayerId });
    expect((await router(jsonRequest('POST', `/api/games/${gameId}/dice-rolls`, { playerId: firstPlayerId, first: 4, second: 4 }))).status).toBe(201);
    expect(properties.recordDiceRoll).toHaveBeenCalledWith(gameId, { playerId: firstPlayerId, first: 4, second: 4 });
    expect(controllers).toEqual([firstPlayerId, firstPlayerId]);
    const foreign = createPropertyRouter({ controlled: [secondPlayerId] });
    expect((await foreign.router(jsonRequest('POST', `/api/games/${gameId}/dice-rolls`, { playerId: firstPlayerId, first: 4, second: 4 }))).status).toBe(403);
    expect(foreign.properties.recordDiceRoll).not.toHaveBeenCalled();
  });

  it('serves the board catalogue to the authenticated actor', async () => {
    const { router, boards } = createPropertyRouter();
    expect((await router(new Request('https://example.test/api/boards'))).status).toBe(200);
    expect(boards.list).toHaveBeenCalledWith(ownerId);
    const created = await router(jsonRequest('POST', '/api/boards', { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames }));
    expect(created.status).toBe(201);
    expect(boards.create).toHaveBeenCalledWith(ownerId, { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames });
    expect((await router(new Request('https://example.test/api/boards/board-classic'))).status).toBe(200);
    expect(boards.get).toHaveBeenCalledWith('board-classic', ownerId);
    expect((await router(new Request('https://example.test/api/boards/board-classic', { method: 'DELETE' }))).status).toBe(200);
    expect(boards.delete).toHaveBeenCalledWith('board-classic', ownerId);
    boards.delete.mockRejectedValueOnce(new ConflictError('BOARD_IN_USE', 'A game is still played on this board.'));
    const inUse = await router(new Request('https://example.test/api/boards/board-classic', { method: 'DELETE' }));
    expect(inUse.status).toBe(409);
    await expect(inUse.json()).resolves.toMatchObject({ error: { code: 'BOARD_IN_USE' } });
  });

  function createPropertyRouter(options: { controlled?: string[]; owner?: string | null; live?: boolean; trade?: null } = {}) {
    const controlled = options.controlled ?? [firstPlayerId, secondPlayerId];
    const controllers: string[] = [];
    const operation = { transaction: { ...transactionResponse().transaction, type: 'PROPERTY_PURCHASE' as const }, players: gameDetails.players, properties: [{ boardSpaceId, ownerPlayerId: secondPlayerId, houses: 0, mortgaged: false }], buildingBank: { housesAvailable: 32, hotelsAvailable: 12 } };
    const trade = { id: tradeId, gameId, proposerPlayerId: firstPlayerId, responderPlayerId: secondPlayerId, cashFromProposer: 50, cashFromResponder: 0, items: [], state: 'PENDING' as const, expiresAt: '2999-01-01T00:00:00.000Z', createdAt: '', resolvedAt: null, transactionId: null };
    const properties = {
      state: vi.fn(async () => ({ board: { id: 'board-classic' }, boardSpaces: [], properties: operation.properties, buildingBank: operation.buildingBank })),
      ownerOf: vi.fn(async () => (options.owner === undefined ? secondPlayerId : options.owner)),
      purchase: vi.fn(async () => operation), chargeRent: vi.fn(async () => operation), build: vi.fn(async () => operation), sellBuildings: vi.fn(async () => operation), mortgage: vi.fn(async () => operation), unmortgage: vi.fn(async () => operation), recordAuction: vi.fn(async () => operation),
      payJailBail: vi.fn(async () => ({ transaction: operation.transaction, players: gameDetails.players })),
      recordDiceRoll: vi.fn(async () => ({ player: gameDetails.players[0], thirdDouble: false })),
    };
    const trades = {
      list: vi.fn(async () => [trade]), get: vi.fn(async () => (options.trade === null ? null : trade)),
      propose: vi.fn(async () => ({ trade, players: gameDetails.players })), accept: vi.fn(async () => ({ trade, players: gameDetails.players })), decline: vi.fn(async () => ({ trade, players: gameDetails.players })), cancel: vi.fn(async () => ({ trade, players: gameDetails.players })),
    };
    const boards = { list: vi.fn(async () => []), get: vi.fn(async () => ({ board: { id: 'board-classic' }, spaces: [] })), create: vi.fn(async () => ({ board: { id: 'copy' }, spaces: [] })), delete: vi.fn(async () => ({ boardId: 'board-classic' })) };
    const live = { connect: vi.fn(async () => new Response()), mutate: vi.fn(async () => Response.json({ data: operation }, { status: 201 })) };
    const access = {
      requireMember: async () => 'PLAYER' as const,
      requireOwner: async () => undefined,
      requirePlayerController: async (_gameId: string, _userId: string, playerId: string) => { controllers.push(playerId); if (!controlled.includes(playerId)) throw new ForbiddenError(); },
      controlledWallets: async () => controlled.map((playerId) => ({ playerId, kind: 'PRIMARY' as const })),
    };
    const router = createApiRouter({
      games: { createGameForOwner: async () => gameDetails, getGame: async () => gameDetails } as never,
      banking: {} as BankingService,
      auth: { current: async () => ({ id: ownerId, nickname: 'Test', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never,
      access: access as never,
      profileStatistics: {} as never,
      properties: properties as never,
      trades: trades as never,
      boards: boards as never,
      ...(options.live === true ? { live } : {}),
    });
    return { router, properties, trades, boards, live, controllers };
  }
});

function createTestRouter(overrides: Partial<TestServiceOverrides> = {}) {
  const games: GameService = {
    listGames: async (): Promise<GameSummary[]> => [],
    listGamesForUser: async (): Promise<GameSummary[]> => [],
    createGame: async () => gameDetails,
    createGameForOwner: async (_userId, request) => games.createGame(request),
    getGame: async () => gameDetails,
    deleteGame: async (requestedGameId) => ({ gameId: requestedGameId }),
    ...pickGameOverrides(overrides),
  };
  const banking: BankingService = {
    createTransaction: async () => transactionResponse(),
    listTransactions: async () => [],
    listPlayerTransactions: async () => [],
    ...pickBankingOverrides(overrides),
  };
  const auth = { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Test', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) };
  const access = { requireMember: async () => 'PLAYER' as const, requireOwner: async () => undefined, requirePlayerController: async () => undefined, controlledWallets: async () => [] };
  const profileStatistics = { recordCompletedGame: async () => undefined };
  return createApiRouter({ games, banking, auth: auth as never, access: access as never, profileStatistics: profileStatistics as never });
}

interface TestServiceOverrides {
  createGame: GameService['createGame'];
  getGame: GameService['getGame'];
  deleteGame: GameService['deleteGame'];
  createTransaction: BankingService['createTransaction'];
  listTransactions: BankingService['listTransactions'];
  listPlayerTransactions: BankingService['listPlayerTransactions'];
}

function pickGameOverrides(overrides: Partial<TestServiceOverrides>): Partial<GameService> {
  const { createGame, getGame, deleteGame } = overrides;
  return {
    ...(createGame === undefined ? {} : { createGame }),
    ...(getGame === undefined ? {} : { getGame }),
    ...(deleteGame === undefined ? {} : { deleteGame }),
  };
}

function pickBankingOverrides(overrides: Partial<TestServiceOverrides>): Partial<BankingService> {
  const { createTransaction, listTransactions, listPlayerTransactions } = overrides;
  return {
    ...(createTransaction === undefined ? {} : { createTransaction }),
    ...(listTransactions === undefined ? {} : { listTransactions }),
    ...(listPlayerTransactions === undefined ? {} : { listPlayerTransactions }),
  };
}

function jsonRequest(method: string, path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function transactionResponse() {
  return {
    transaction: {
      id: '00000000-0000-4000-8000-000000000004',
      gameId,
      type: 'PLAYER_TO_PLAYER' as const,
      amount: 100,
      totalAmount: 100,
      comment: null,
      createdAt: '2026-01-01T00:00:00Z',
      participants: [
        { playerId: firstPlayerId, balanceDelta: -100 },
        { playerId: secondPlayerId, balanceDelta: 100 },
      ],
    },
    players: gameDetails.players,
  };
}
