import { describe, expect, it, vi } from 'vitest';
import { DefaultGameService } from './game-service.js';
import { ConflictError } from './errors.js';
import { defaultGameRules, type Game } from '../../shared/types/monopoly.js';

const game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K' as const,
  paymentMode: 'FAST' as const,
  rules: defaultGameRules,
  settings: null,
  status: 'LOBBY' as const,
  createdAt: '',
  updatedAt: '',
  startedAt: null,
  finishedAt: null,
};
const players = [
  {
    id: 'player-1',
    gameId: 'game',
    name: 'Ada',
    color: '#123456',
    balance: 1500,
    status: 'ACTIVE' as const,
    createdAt: '',
  },
  {
    id: 'player-2',
    gameId: 'game',
    name: 'Lin',
    color: '#654321',
    balance: 1500,
    status: 'ACTIVE' as const,
    createdAt: '',
  },
];

describe('DefaultGameService lifecycle', () => {
  it('starts only a lobby with at least two players and finishes only an active game', async () => {
    let current: Game = game;
    const service = new DefaultGameService({
      games: {
        getById: async () => current,
        transitionStatus: async (_id, from, to) => {
          if (current.status !== from) return null;
          current = { ...current, status: to };
          return current;
        },
        listFavoriteAmounts: async () => [],
        listRecentAmounts: async () => [],
      } as never,
      players: { listByGameId: async () => players } as never,
      createId: () => 'unused',
    });
    await expect(service.startGame('game')).resolves.toMatchObject({ game: { status: 'ACTIVE' } });
    await expect(service.finishGame('game')).resolves.toMatchObject({
      game: { status: 'FINISHED' },
    });
    await expect(service.finishGame('game')).rejects.toBeInstanceOf(ConflictError);
  });

  it('stores the chosen rules with a settings snapshot derived from the starting balance', async () => {
    const createWithPlayers = vi.fn(async () => undefined);
    const service = new DefaultGameService({
      games: {
        createWithPlayers,
        getById: async () => game,
        listFavoriteAmounts: async () => [],
        listRecentAmounts: async () => [],
      } as never,
      players: { listByGameId: async () => players } as never,
      createId: () => 'id',
    });
    const request = {
      name: 'Table',
      startingBalance: 15_000_000,
      passGoReward: 2_000_000,
      currency: 'USD' as const,
      players: [{ name: 'Ada', color: '#123456' }],
    };

    await service.createGameForOwner('owner', {
      ...request,
      rules: { ...defaultGameRules, freeParkingJackpot: true },
    });
    await service.createGameForOwner('owner', request);

    const [chosen, omitted] = createWithPlayers.mock.calls.map(([input]) => input as never) as {
      rules: unknown;
      settings: { unit: number; incomeTax: number };
    }[];
    expect(chosen?.rules).toEqual({ ...defaultGameRules, freeParkingJackpot: true });
    expect(chosen?.settings).toMatchObject({ unit: 100_000, incomeTax: 2_000_000 });
    expect(omitted?.rules).toEqual(defaultGameRules);
  });

  it('copies the rules when a game is duplicated', async () => {
    const createWithPlayers = vi.fn(async () => undefined);
    const rules = { ...defaultGameRules, auctions: true };
    const service = new DefaultGameService({
      games: {
        createWithPlayers,
        getById: async () => ({ ...game, rules }),
        listFavoriteAmounts: async () => [],
        listRecentAmounts: async () => [],
      } as never,
      players: { listByGameId: async () => players } as never,
      createId: () => 'id',
    });

    await service.duplicateGameForOwner('owner', 'game', 'secret');

    expect(createWithPlayers).toHaveBeenCalledWith(
      expect.objectContaining({ rules }),
      expect.anything(),
    );
  });
});
