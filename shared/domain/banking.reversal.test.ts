import { describe, expect, it } from 'vitest';
import type { Game, Player, Transaction } from '../types/monopoly.js';
import {
  InsufficientFundsError,
  InvalidGameStateError,
  PlayerBankruptError,
  reverseTransaction,
  TransactionAlreadyReversedError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
} from './banking.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: {
    doubleRewardOnExactGo: false,
    playerLoans: false,
    bankLoans: false,
    freeParkingJackpot: false,
    auctions: false,
  },
  settings: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function players(balances: readonly number[], overrides: Partial<Player>[] = []): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides[index],
  }));
}

function original(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'original',
    gameId: game.id,
    type: 'PLAYER_TO_PLAYER',
    amount: 100,
    totalAmount: 100,
    comment: null,
    createdAt: '2026-01-01 10:00:00',
    participants: [
      { playerId: 'player-1', balanceDelta: -100 },
      { playerId: 'player-2', balanceDelta: 100 },
    ],
    ...overrides,
  };
}

const balancesAfter = (result: ReturnType<typeof reverseTransaction>) =>
  result.affectedPlayers.map((change) => [change.player.id, change.balanceAfter]);

describe('reverseTransaction', () => {
  it('moves the original amounts back and links the new record to the original', () => {
    // After the original: player-1 paid 100 to player-2.
    const result = reverseTransaction({
      game,
      players: players([1400, 1600, 1500]),
      original: original(),
      comment: 'Wrong player',
    });

    expect(balancesAfter(result)).toEqual([
      ['player-1', 1500],
      ['player-2', 1500],
    ]);
    expect(result.transaction).toEqual({
      gameId: game.id,
      type: 'REVERSAL',
      amount: 100,
      totalAmount: 100,
      comment: 'Wrong player',
      reversesTransactionId: 'original',
      participants: [
        { playerId: 'player-1', balanceDelta: 100 },
        { playerId: 'player-2', balanceDelta: -100 },
      ],
    });
  });

  it('reverses a payment to everyone, taking each share back', () => {
    const result = reverseTransaction({
      game,
      players: players([1300, 1600, 1600]),
      original: original({
        type: 'PLAYER_TO_ALL',
        amount: 100,
        totalAmount: 200,
        participants: [
          { playerId: 'player-1', balanceDelta: -200 },
          { playerId: 'player-2', balanceDelta: 100 },
          { playerId: 'player-3', balanceDelta: 100 },
        ],
      }),
    });

    expect(balancesAfter(result)).toEqual([
      ['player-1', 1500],
      ['player-2', 1500],
      ['player-3', 1500],
    ]);
    expect(result.transaction).toMatchObject({ amount: 100, totalAmount: 200 });
  });

  it('takes back money the bank paid out', () => {
    const result = reverseTransaction({
      game,
      players: players([1700, 1500]),
      original: original({
        type: 'PASS_GO',
        amount: 200,
        totalAmount: 200,
        participants: [{ playerId: 'player-1', balanceDelta: 200 }],
      }),
    });
    expect(balancesAfter(result)).toEqual([['player-1', 1500]]);
  });

  it('rejects the reversal when a player no longer holds the money, changing nothing', () => {
    const state = players([1400, 40, 1500]);
    expect(() => reverseTransaction({ game, players: state, original: original() })).toThrow(
      InsufficientFundsError,
    );
    expect(state.map((player) => player.balance)).toEqual([1400, 40, 1500]);
  });

  it('rejects reversing a reversal, a bankruptcy transfer or an already reversed transaction', () => {
    const state = players([1500, 1500]);
    expect(() =>
      reverseTransaction({ game, players: state, original: original({ type: 'REVERSAL' }) }),
    ).toThrow(TransactionNotReversibleError);
    expect(() =>
      reverseTransaction({
        game,
        players: state,
        original: original({ type: 'BANKRUPTCY_TRANSFER' }),
      }),
    ).toThrow(TransactionNotReversibleError);
    expect(() =>
      reverseTransaction({
        game,
        players: state,
        original: original({ reversedByTransactionId: 'earlier-reversal' }),
      }),
    ).toThrow(TransactionAlreadyReversedError);
  });

  it('rejects a transaction from another game and a bankrupt participant', () => {
    expect(() =>
      reverseTransaction({
        game,
        players: players([1500, 1500]),
        original: original({ gameId: 'other-game' }),
      }),
    ).toThrow(TransactionNotFoundError);
    expect(() =>
      reverseTransaction({
        game,
        players: players([1400, 0], [{}, { status: 'BANKRUPT' }]),
        original: original(),
      }),
    ).toThrow(PlayerBankruptError);
  });

  it('rejects a reversal once the game is no longer active', () => {
    expect(() =>
      reverseTransaction({
        game: { ...game, status: 'FINISHED' },
        players: players([1400, 1600]),
        original: original(),
      }),
    ).toThrow(InvalidGameStateError);
  });
});
