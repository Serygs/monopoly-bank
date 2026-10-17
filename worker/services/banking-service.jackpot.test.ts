import { describe, expect, it, vi } from 'vitest';
import type { Game, Player, Transaction } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';
import { DatabaseError } from './errors.js';

const aId = '11111111-1111-4111-8111-111111111111';
const bId = '22222222-2222-4222-8222-222222222222';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, freeParkingJackpot: true },
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, balance: number, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'game',
  name: id,
  color: '#000',
  balance,
  status,
  createdAt: '',
});

type Persisted = {
  transaction: { type: string; amount: number; jackpot?: unknown; participants: unknown[] };
  balanceChanges: { balanceDelta: number }[];
  recentAmount?: number;
};

function setup(
  options: {
    game?: Game;
    aBalance?: number;
    /** The pot on each read; the last value repeats. */
    pots?: number[];
    persistError?: Error;
  } = {},
) {
  const table = options.game ?? game;
  const pots = options.pots ?? [0];
  let reads = 0;
  const getJackpot = vi.fn(async () => pots[Math.min(reads++, pots.length - 1)] ?? 0);
  let persistedType: string | null = null;
  const persist = vi.fn(async (input: unknown) => {
    if (options.persistError !== undefined) throw options.persistError;
    persistedType = (input as Persisted).transaction.type;
  });
  const banking = new DefaultBankingService({
    games: { getById: async () => table, getJackpot } as never,
    players: {
      listByGameId: async () => [player(aId, options.aBalance ?? 1000), player(bId, 500)],
    } as never,
    transactions: {
      getById: async (_gameId: string, id: string) =>
        persistedType !== null && id === 'command-id'
          ? ({ id, type: persistedType } as Transaction)
          : null,
    } as never,
    operations: { persist } as never,
    paymentRequests: {} as never,
    mortgages: { listActive: async () => [], getActive: async () => null } as never,
    loans: { listActive: async () => [] } as never,
    createId: () => 'command-id',
  });
  return { banking, persist, getJackpot };
}

const payIn = (amount: number, playerId = aId) => ({
  type: 'TO_JACKPOT' as const,
  playerId,
  amount,
  comment: 'Income tax',
});
const collect = (expectedAmount: number, playerId = bId) => ({
  type: 'JACKPOT_PAYOUT' as const,
  playerId,
  expectedAmount,
});
const persisted = (persist: ReturnType<typeof setup>['persist']) =>
  persist.mock.calls[0]![0] as Persisted;

describe('TO_JACKPOT', () => {
  it('debits the payer, deposits into the pot and answers with the pot', async () => {
    const { banking, persist } = setup({ pots: [200] });

    const response = await banking.createTransaction('game', payIn(200));

    expect(persisted(persist)).toMatchObject({
      transaction: {
        type: 'TO_JACKPOT',
        amount: 200,
        comment: 'Income tax',
        jackpot: { kind: 'DEPOSIT', amount: 200 },
        participants: [{ playerId: aId, balanceDelta: -200 }],
      },
      recentAmount: 200,
    });
    expect(response).toMatchObject({ jackpot: 200 });
  });

  it('is rejected with RULE_DISABLED when the game does not have the rule', async () => {
    const { banking, persist } = setup({ game: { ...game, rules: defaultGameRules } });

    await expect(banking.createTransaction('game', payIn(100))).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects an unaffordable payment with INSUFFICIENT_FUNDS and writes nothing', async () => {
    const { banking, persist } = setup({ aBalance: 50 });

    await expect(banking.createTransaction('game', payIn(100))).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a finished game, a bankrupt payer and an invalid amount', async () => {
    const finished = setup({ game: { ...game, status: 'FINISHED' } });
    await expect(finished.banking.createTransaction('game', payIn(10))).rejects.toMatchObject({
      code: 'GAME_FINISHED',
    });
    const invalid = setup();
    await expect(invalid.banking.createTransaction('game', payIn(0))).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    });
    expect(finished.persist).not.toHaveBeenCalled();
    expect(invalid.persist).not.toHaveBeenCalled();
  });
});

describe('JACKPOT_PAYOUT', () => {
  it('pays the whole pot, read on the server, to the collector', async () => {
    const { banking, persist } = setup({ pots: [275, 0] });

    const response = await banking.createTransaction('game', collect(275));

    const input = persisted(persist);
    expect(input.transaction).toMatchObject({
      type: 'JACKPOT_PAYOUT',
      amount: 275,
      jackpot: { kind: 'COLLECT', expected: 275 },
      participants: [{ playerId: bId, balanceDelta: 275 }],
    });
    expect(input.balanceChanges).toMatchObject([{ balanceDelta: 275 }]);
    expect(input).not.toHaveProperty('recentAmount');
    expect(response).toMatchObject({ jackpot: 0 });
  });

  it('is rejected with RULE_DISABLED when the game does not have the rule', async () => {
    const { banking, persist, getJackpot } = setup({
      game: { ...game, rules: defaultGameRules },
      pots: [100],
    });

    await expect(banking.createTransaction('game', collect(200))).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    expect(getJackpot).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects an empty pot with JACKPOT_EMPTY (409) and writes nothing', async () => {
    const { banking, persist } = setup({ pots: [0] });

    await expect(banking.createTransaction('game', collect(200))).rejects.toMatchObject({
      code: 'JACKPOT_EMPTY',
      status: 409,
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses a pot other than the reviewed one with JACKPOT_CHANGED and writes nothing', async () => {
    const { banking, persist } = setup({ pots: [320] });

    await expect(banking.createTransaction('game', collect(275))).rejects.toMatchObject({
      code: 'JACKPOT_CHANGED',
      status: 409,
      details: { jackpot: 320, expectedAmount: 275 },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports JACKPOT_EMPTY, not JACKPOT_CHANGED, when the reviewed pot is gone', async () => {
    const { banking, persist } = setup({ pots: [0] });

    await expect(banking.createTransaction('game', collect(275))).rejects.toMatchObject({
      code: 'JACKPOT_EMPTY',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports JACKPOT_EMPTY when someone else collected between the read and the write', async () => {
    const { banking } = setup({
      pots: [200, 0],
      persistError: new DatabaseError({ operation: 'persistBankingOperation' }),
    });

    await expect(banking.createTransaction('game', collect(200))).rejects.toMatchObject({
      code: 'JACKPOT_EMPTY',
    });
  });

  it('reports a retryable JACKPOT_CHANGED when the pot grew between the read and the write', async () => {
    const { banking } = setup({
      pots: [200, 250],
      persistError: new DatabaseError({ operation: 'persistBankingOperation' }),
    });

    await expect(banking.createTransaction('game', collect(200))).rejects.toMatchObject({
      code: 'JACKPOT_CHANGED',
      status: 409,
      details: { jackpot: 250, expectedAmount: 200 },
    });
  });

  it('rethrows any other storage failure unchanged', async () => {
    const failure = new DatabaseError({ operation: 'persistBankingOperation' });
    const { banking } = setup({ pots: [200, 200], persistError: failure });

    await expect(banking.createTransaction('game', collect(200))).rejects.toBe(failure);
  });

  it('rejects a bankrupt collector and a finished game', async () => {
    const finished = setup({ game: { ...game, status: 'FINISHED' }, pots: [100] });
    await expect(finished.banking.createTransaction('game', collect(200))).rejects.toMatchObject({
      code: 'GAME_FINISHED',
    });
    expect(finished.persist).not.toHaveBeenCalled();
  });
});

describe('the pot on other responses', () => {
  it('is omitted from a transaction response without the rule', async () => {
    const { banking } = setup({ game: { ...game, rules: defaultGameRules } });

    const response = await banking.createTransaction('game', {
      type: 'PLAYER_TO_BANK',
      playerId: aId,
      amount: 10,
    });

    expect(response).not.toHaveProperty('jackpot');
  });

  it('is carried by an unrelated transaction response with the rule', async () => {
    const { banking } = setup({ pots: [320] });

    const response = await banking.createTransaction('game', {
      type: 'PLAYER_TO_BANK',
      playerId: aId,
      amount: 10,
    });

    expect(response).toMatchObject({ jackpot: 320 });
  });

  it('is carried by a bankruptcy response, with the pot untouched', async () => {
    const { banking, persist } = setup({ pots: [320] });

    const response = await banking.declareBankruptcy('game', {
      playerId: bId,
      creditorPlayerId: aId,
    });

    expect(response).toMatchObject({ jackpot: 320 });
    expect(persisted(persist).transaction).not.toHaveProperty('jackpot');
  });
});
