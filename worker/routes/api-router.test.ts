import { describe, expect, it } from 'vitest';

import type { CreateGameRequest, CreateTransactionRequest, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import { InsufficientFundsError } from '../../shared/domain/banking.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { BankingService } from '../services/banking-service.js';
import { ResourceNotFoundError } from '../services/errors.js';
import type { GameService } from '../services/game-service.js';
import { createApiRouter } from './api-router.js';

const gameDetails: GameDetails = {
  game: {
    id: 'game-1',
    name: 'Friday Monopoly',
    startingBalance: 1500,
    passGoReward: 200,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  players: [
    { id: 'player-1', gameId: 'game-1', name: 'Ada', color: '#123456', balance: 1500, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'player-2', gameId: 'game-1', name: 'Lin', color: '#654321', balance: 1500, createdAt: '2026-01-01T00:00:00Z' },
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
      players: [
        { name: 'Ada', color: '#123456' },
        { name: 'Lin', color: '#654321' },
      ],
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

    const response = await router(jsonRequest('POST', '/api/games/game-1/transactions', {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: 'player-1',
      destinationPlayerId: 'player-2',
      amount: 100,
    }));

    expect(response.status).toBe(201);
    expect(received).toMatchObject({ type: 'PLAYER_TO_PLAYER', amount: 100 });
  });

  it.each([
    ['PLAYER_TO_ALL', { payerPlayerId: 'player-1', amountPerPlayer: 100 }],
    ['ALL_TO_PLAYER', { recipientPlayerId: 'player-1', amountPerPlayer: 100 }],
  ] as const)('returns atomic insufficient-funds failure for %s', async (type, fields) => {
    const router = createTestRouter({
      createTransaction: async () => {
        throw new InsufficientFundsError('player-1', 50, 200);
      },
    });

    const response = await router(jsonRequest('POST', '/api/games/game-1/transactions', { type, ...fields }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds.',
        details: { playerId: 'player-1', currentBalance: 50, requiredAmount: 200, shortfall: 150 },
      },
    });
  });

  it('returns 404 for a missing game', async () => {
    const router = createTestRouter({
      getGame: async () => {
        throw new ResourceNotFoundError('Game');
      },
    });

    const response = await router(new Request('https://example.test/api/games/missing'));
    expect(response.status).toBe(404);
  });

  it('returns 404 for a missing player history', async () => {
    const router = createTestRouter({
      listPlayerTransactions: async () => {
        throw new ResourceNotFoundError('Player');
      },
    });

    const response = await router(new Request('https://example.test/api/games/game-1/players/missing/transactions'));
    expect(response.status).toBe(404);
  });

  it('returns game transaction history', async () => {
    const history: Transaction[] = [transactionResponse().transaction];
    const router = createTestRouter({ listTransactions: async () => history });

    const response = await router(new Request('https://example.test/api/games/game-1/transactions'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: history });
  });
});

function createTestRouter(overrides: Partial<TestServiceOverrides> = {}) {
  const games: GameService = {
    listGames: async (): Promise<GameSummary[]> => [],
    createGame: async () => gameDetails,
    getGame: async () => gameDetails,
    ...pickGameOverrides(overrides),
  };
  const banking: BankingService = {
    createTransaction: async () => transactionResponse(),
    listTransactions: async () => [],
    listPlayerTransactions: async () => [],
    ...pickBankingOverrides(overrides),
  };
  return createApiRouter({ games, banking });
}

interface TestServiceOverrides {
  createGame: GameService['createGame'];
  getGame: GameService['getGame'];
  createTransaction: BankingService['createTransaction'];
  listTransactions: BankingService['listTransactions'];
  listPlayerTransactions: BankingService['listPlayerTransactions'];
}

function pickGameOverrides(overrides: Partial<TestServiceOverrides>): Partial<GameService> {
  const { createGame, getGame } = overrides;
  return {
    ...(createGame === undefined ? {} : { createGame }),
    ...(getGame === undefined ? {} : { getGame }),
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
      id: 'transaction-1',
      gameId: 'game-1',
      type: 'PLAYER_TO_PLAYER' as const,
      amount: 100,
      totalAmount: 100,
      comment: null,
      createdAt: '2026-01-01T00:00:00Z',
      participants: [
        { playerId: 'player-1', balanceDelta: -100 },
        { playerId: 'player-2', balanceDelta: 100 },
      ],
    },
    players: gameDetails.players,
  };
}
