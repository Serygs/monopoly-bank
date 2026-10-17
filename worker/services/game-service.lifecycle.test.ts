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

  it('reports the active mortgages with the game, and none when mortgages are not wired', async () => {
    const mortgages = [
      {
        id: 'm1',
        gameId: 'game',
        playerId: 'player-1',
        propertyName: 'Boardwalk',
        mortgageValue: 400,
        createdAt: '',
      },
    ];
    const dependencies = {
      games: {
        getById: async () => game,
        listFavoriteAmounts: async () => [],
        listRecentAmounts: async () => [],
      } as never,
      players: { listByGameId: async () => players } as never,
      createId: () => 'unused',
    };

    const wired = new DefaultGameService({
      ...dependencies,
      mortgages: { listActive: async () => mortgages, getActive: async () => null },
    });
    await expect(wired.getGame('game')).resolves.toMatchObject({ mortgages });
    await expect(new DefaultGameService(dependencies).getGame('game')).resolves.toMatchObject({
      mortgages: [],
    });
  });
});

describe('DefaultGameService bank loans', () => {
  const bankLoan = {
    id: 'loan-1',
    gameId: 'game',
    lenderKind: 'BANK' as const,
    lenderPlayerId: null,
    borrowerPlayerId: 'player-1',
    principal: 100,
    repaidAmount: 0,
    state: 'ACTIVE' as const,
    createdAt: '',
    closedAt: null,
  };
  const repositories = (rules: typeof defaultGameRules) => ({
    games: {
      getById: async () => ({ ...game, rules }),
      listFavoriteAmounts: async () => [],
      listRecentAmounts: async () => [],
    } as never,
    players: { listByGameId: async () => players } as never,
    loans: {
      listActive: async () => [bankLoan],
      listBankLoanRepayments: async () => [],
    } as never,
    transactions: {
      listChronologicalSince: async () => [
        { id: 'loan-1', type: 'LOAN_ISSUE', participants: [] },
        {
          id: 't2',
          type: 'PLAYER_TO_BANK',
          participants: [{ playerId: 'player-1', balanceDelta: -1 }],
        },
        {
          id: 't3',
          type: 'PLAYER_TO_BANK',
          participants: [{ playerId: 'player-2', balanceDelta: -1 }],
        },
        {
          id: 't4',
          type: 'PLAYER_TO_BANK',
          participants: [{ playerId: 'player-1', balanceDelta: -1 }],
        },
      ],
    } as never,
    createId: () => 'unused',
  });

  it('reports the rounds of active bank loans and the cooldowns with a game that enabled them', async () => {
    const details = await new DefaultGameService(
      repositories({ ...defaultGameRules, bankLoans: true }),
    ).getGame('game');

    expect(details.bankLoanCooldowns).toEqual([]);
    expect(details.loans).toEqual([
      { ...bankLoan, rounds: { round: 2, suggestedRatePercent: 10, overdue: false } },
    ]);
  });

  it('leaves the loans plain and reports no cooldowns without the rule', async () => {
    const details = await new DefaultGameService(repositories(defaultGameRules)).getGame('game');

    expect(details.bankLoanCooldowns).toBeUndefined();
    expect(details.loans).toEqual([bankLoan]);
  });
});

describe('DefaultGameService Free Parking jackpot', () => {
  const repositories = (rules: typeof defaultGameRules) => ({
    games: {
      getById: async () => ({ ...game, rules }),
      getJackpot: async () => 275,
      listFavoriteAmounts: async () => [],
      listRecentAmounts: async () => [],
    } as never,
    players: { listByGameId: async () => players } as never,
    createId: () => 'unused',
  });

  it('reports the pot with a game that enabled the rule', async () => {
    const details = await new DefaultGameService(
      repositories({ ...defaultGameRules, freeParkingJackpot: true }),
    ).getGame('game');

    expect(details.jackpot).toBe(275);
  });

  it('omits the pot without the rule', async () => {
    const details = await new DefaultGameService(repositories(defaultGameRules)).getGame('game');

    expect(details).not.toHaveProperty('jackpot');
  });
});

describe('regenerateJoinCode', () => {
  const service = (
    replaceJoinCode: (id: string, owner: string, code: string) => Promise<boolean>,
  ) =>
    new DefaultGameService({
      games: { replaceJoinCode } as never,
      players: {} as never,
      createId: () => 'id',
    });

  it('retries on a join code collision with another game and returns the code that stuck', async () => {
    const tried: string[] = [];
    const result = await service(async (_id, _owner, code) => {
      tried.push(code);
      if (tried.length < 3)
        throw new Error('D1_ERROR', {
          cause: new Error('UNIQUE constraint failed: games.join_code'),
        });
      return true;
    }).regenerateJoinCode('game', 'owner');
    expect(tried).toHaveLength(3);
    expect(result).toEqual({ joinCode: tried[2] });
  });

  it('gives up after repeated collisions and reports a game that cannot change code', async () => {
    await expect(
      service(async () => {
        throw new Error('UNIQUE constraint failed: games.join_code');
      }).regenerateJoinCode('game', 'owner'),
    ).rejects.toThrow(/UNIQUE/u);
    await expect(
      service(async () => false).regenerateJoinCode('game', 'owner'),
    ).rejects.toMatchObject({ code: 'JOIN_CODE_UNAVAILABLE' });
  });
});
