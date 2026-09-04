import { describe, expect, it } from 'vitest';

import type { CreateGameRequest, CreateTransactionRequest, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import { InsufficientFundsError } from '../../shared/domain/banking.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { BankingService } from '../services/banking-service.js';
import { ResourceNotFoundError } from '../services/errors.js';
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
      currency: 'K',
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
      currency: 'K',
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
      currency: 'K',
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
    const router = createApiRouter({ games, banking, auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Test', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never, access: { requireMember: async () => { throw new ResourceNotFoundError('Game'); } } as never, profileStatistics: { recordCompletedGame: async () => undefined } as never });
    const response = await router(new Request(`https://example.test/api/games/${gameId}`));
    expect(response.status).toBe(404);
  });

  it('exposes an invitation code only to the game owner', async () => {
    const games: GameService = { listGames: async () => [], listGamesForUser: async () => [], createGameForOwner: async () => gameDetails, getGame: async () => gameDetails, deleteGame: async () => ({ gameId }), duplicateGameForOwner: async () => gameDetails, finishGame: async () => gameDetails, toggleFavoriteAmount: async () => [] };
    const banking: BankingService = { createTransaction: async () => transactionResponse(), listTransactions: async () => [], listPlayerTransactions: async () => [] };
    const router = createApiRouter({ games, banking, auth: { current: async () => ({ id: '00000000-0000-4000-8000-000000000099', nickname: 'Owner', avatar: '🧩', gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: '', updatedAt: '' }) } as never, access: { requireMember: async () => 'OWNER', ownerJoinCode: async () => 'TABLE42' } as never, profileStatistics: { recordCompletedGame: async () => undefined } as never });

    const response = await router(new Request(`https://example.test/api/games/${gameId}`));

    await expect(response.json()).resolves.toMatchObject({ data: { canManage: true, joinCode: 'TABLE42' } });
  });

  it('does not expose an invitation code to a player member', async () => {
    const response = await createTestRouter()(new Request(`https://example.test/api/games/${gameId}`));

    await expect(response.json()).resolves.toEqual({ data: { ...gameDetails, canManage: false } });
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
  const access = { requireMember: async () => 'PLAYER' as const, requireOwner: async () => undefined };
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
