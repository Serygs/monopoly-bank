import { describe, expect, it } from 'vitest';
import type { Game, Player, Transaction } from '../types/monopoly.js';
import { defaultGameRules } from '../types/monopoly.js';
import {
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  JackpotChangedError,
  JackpotEmptyError,
  PlayerBankruptError,
  PlayerNotFoundError,
  jackpotPayout,
  declareBankruptcy,
  reverseTransaction,
  toJackpot,
  TransactionNotReversibleError,
} from './banking.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
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

function players(balances: readonly number[], overrides: Partial<Player>[] = []): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '',
    ...overrides[index],
  }));
}

describe('toJackpot', () => {
  const command = { game, playerId: 'player-1', amount: 200 };

  it('debits only the payer and records the deposit into the pot', () => {
    const result = toJackpot({ ...command, players: players([500, 300]), comment: 'Income tax' });

    expect(result.transaction).toMatchObject({
      gameId: game.id,
      type: 'TO_JACKPOT',
      amount: 200,
      totalAmount: 200,
      comment: 'Income tax',
      participants: [{ playerId: 'player-1', balanceDelta: -200 }],
      jackpot: { kind: 'DEPOSIT', amount: 200 },
    });
    expect(result.affectedPlayers).toMatchObject([
      { balanceBefore: 500, balanceAfter: 300, balanceDelta: -200 },
    ]);
  });

  it('lets the payer spend their last coin', () => {
    const result = toJackpot({ ...command, players: players([200, 300]) });

    expect(result.affectedPlayers[0]).toMatchObject({ balanceAfter: 0 });
  });

  it('rejects an amount the payer cannot cover and reports the shortfall', () => {
    expect.assertions(4);
    try {
      toJackpot({ ...command, players: players([199, 300]) });
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      expect(error).toMatchObject({ currentBalance: 199, requiredAmount: 200, shortfall: 1 });
      expect((error as InsufficientFundsError).code).toBe('INSUFFICIENT_FUNDS');
      expect((error as InsufficientFundsError).status).toBe(409);
    }
  });

  it.each([0, -5, 1.5, Number.NaN, 2 ** 60])('rejects the amount %s', (amount) => {
    expect(() => toJackpot({ ...command, amount, players: players([500, 300]) })).toThrow(
      InvalidAmountError,
    );
  });

  it('rejects an unknown, bankrupt or finished-game payer', () => {
    expect(() =>
      toJackpot({ ...command, playerId: 'nobody', players: players([500, 300]) }),
    ).toThrow(PlayerNotFoundError);
    expect(() =>
      toJackpot({ ...command, players: players([500, 300], [{ status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      toJackpot({
        ...command,
        game: { ...game, status: 'FINISHED' },
        players: players([500, 300]),
      }),
    ).toThrow(InvalidGameStateError);
  });
});

describe('jackpotPayout', () => {
  const command = { game, playerId: 'player-2', jackpot: 275, expectedAmount: 275 };

  it('pays the whole pot to the collector and records the guarded emptying', () => {
    const result = jackpotPayout({ ...command, players: players([500, 300]) });

    expect(result.transaction).toMatchObject({
      type: 'JACKPOT_PAYOUT',
      amount: 275,
      totalAmount: 275,
      comment: null,
      participants: [{ playerId: 'player-2', balanceDelta: 275 }],
      jackpot: { kind: 'COLLECT', expected: 275 },
    });
    expect(result.affectedPlayers).toMatchObject([
      { balanceBefore: 300, balanceAfter: 575, balanceDelta: 275 },
    ]);
  });

  it('rejects an empty pot with JACKPOT_EMPTY', () => {
    expect.assertions(3);
    try {
      jackpotPayout({ ...command, jackpot: 0, players: players([500, 300]) });
    } catch (error) {
      expect(error).toBeInstanceOf(JackpotEmptyError);
      expect((error as JackpotEmptyError).code).toBe('JACKPOT_EMPTY');
      expect((error as JackpotEmptyError).status).toBe(409);
    }
  });

  it('refuses a pot that differs from the reviewed one with JACKPOT_CHANGED', () => {
    expect.assertions(4);
    try {
      jackpotPayout({ ...command, expectedAmount: 200, players: players([500, 300]) });
    } catch (error) {
      expect(error).toBeInstanceOf(JackpotChangedError);
      expect((error as JackpotChangedError).code).toBe('JACKPOT_CHANGED');
      expect((error as JackpotChangedError).status).toBe(409);
      expect((error as JackpotChangedError).details).toEqual({ jackpot: 275, expectedAmount: 200 });
    }
  });

  it('reports an empty pot as JACKPOT_EMPTY even when a different amount was reviewed', () => {
    expect(() =>
      jackpotPayout({ ...command, jackpot: 0, expectedAmount: 275, players: players([500, 300]) }),
    ).toThrow(JackpotEmptyError);
  });

  it.each([-1, 1.5, Number.NaN])('rejects the invalid pot %s', (jackpot) => {
    expect(() => jackpotPayout({ ...command, jackpot, players: players([500, 300]) })).toThrow(
      InvalidAmountError,
    );
  });

  it('rejects a pot that would overflow the collector balance', () => {
    expect(() =>
      jackpotPayout({
        ...command,
        jackpot: Number.MAX_SAFE_INTEGER,
        expectedAmount: Number.MAX_SAFE_INTEGER,
        players: players([500, 300]),
      }),
    ).toThrow(InvalidGameStateError);
  });

  it('rejects an unknown, bankrupt or finished-game collector', () => {
    expect(() =>
      jackpotPayout({ ...command, playerId: 'nobody', players: players([500, 300]) }),
    ).toThrow(PlayerNotFoundError);
    expect(() =>
      jackpotPayout({ ...command, players: players([500, 300], [{}, { status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      jackpotPayout({
        ...command,
        game: { ...game, status: 'FINISHED' },
        players: players([500, 300]),
      }),
    ).toThrow(InvalidGameStateError);
  });
});

describe('the pot is outside bankruptcy and reversal', () => {
  it('leaves the pot out of a bankruptcy', () => {
    const result = declareBankruptcy({
      game,
      players: players([500, 300]),
      playerId: 'player-1',
      creditorPlayerId: 'player-2',
    });

    expect(result.transaction).not.toHaveProperty('jackpot');
  });

  it.each([
    ['TO_JACKPOT', -200],
    ['JACKPOT_PAYOUT', 200],
  ] as const)('cannot reverse a %s', (type, balanceDelta) => {
    const original: Transaction = {
      id: 'original',
      gameId: game.id,
      type,
      amount: 200,
      totalAmount: 200,
      comment: null,
      createdAt: '',
      participants: [{ playerId: 'player-1', balanceDelta }],
    };

    expect(() => reverseTransaction({ game, players: players([500, 300]), original })).toThrow(
      TransactionNotReversibleError,
    );
  });
});
