import { describe, expect, it } from 'vitest';
import type { Player, Transaction } from '../../shared/types/monopoly';
import {
  playerTransactionAmount,
  transactionAmount,
  transactionDescription,
} from './transaction-history';

const players: Player[] = [
  { id: 'john', gameId: 'game', name: 'John', color: '#111', balance: 800, createdAt: '' },
  { id: 'alex', gameId: 'game', name: 'Alex', color: '#222', balance: 1200, createdAt: '' },
];
const rent: Transaction = {
  id: 'transaction',
  gameId: 'game',
  type: 'PAY_RENT',
  amount: 120,
  totalAmount: 120,
  comment: null,
  createdAt: '',
  participants: [
    { playerId: 'john', balanceDelta: -120 },
    { playerId: 'alex', balanceDelta: 120 },
  ],
};

describe('transaction history formatting', () => {
  it('formats a rent payment with both player names', () => {
    expect(transactionDescription(rent, players)).toBe('John → Alex · Rent');
  });
  it('formats transaction descriptions in Ukrainian', () => {
    expect(transactionDescription(rent, players, 'uk')).toBe('John → Alex · Оренда');
  });
  it('formats multi-player amounts and player-relative values', () => {
    const transaction: Transaction = {
      ...rent,
      type: 'PLAYER_TO_ALL',
      amount: 50,
      totalAmount: 200,
    };
    expect(transactionAmount(transaction, 'K')).toBe('50k each · 200k total');
    expect(playerTransactionAmount(rent, 'john', 'K')).toBe('-120k');
    expect(playerTransactionAmount(rent, 'alex', 'K')).toBe('+120k');
  });
});

describe('reversal formatting', () => {
  const reversal = (participants: Transaction['participants']): Transaction => ({
    ...rent,
    id: 'reversal',
    type: 'REVERSAL',
    reversesTransactionId: 'transaction',
    participants,
  });

  it('names who pays whom in the correction', () => {
    expect(
      transactionDescription(
        reversal([
          { playerId: 'alex', balanceDelta: -120 },
          { playerId: 'john', balanceDelta: 120 },
        ]),
        players,
      ),
    ).toBe('Reversal · Alex → John');
  });

  it('reads one-sided and many-sided reversals as the bank and everyone', () => {
    expect(
      transactionDescription(reversal([{ playerId: 'john', balanceDelta: -200 }]), players),
    ).toBe('Reversal · John → Bank');
    expect(
      transactionDescription(
        reversal([
          { playerId: 'john', balanceDelta: 200 },
          { playerId: 'alex', balanceDelta: -100 },
          { playerId: 'sam', balanceDelta: -100 },
        ]),
        players,
      ),
    ).toBe('Reversal · Everyone → John');
  });

  it('shows the amount moved back', () => {
    expect(transactionAmount({ ...reversal([]), totalAmount: 120 }, 'USD')).toBe('$120');
  });
});

describe('mortgage formatting', () => {
  const mortgage: Transaction = {
    ...rent,
    id: 'mortgage',
    type: 'MORTGAGE',
    amount: 400,
    totalAmount: 400,
    comment: 'Boardwalk',
    participants: [{ playerId: 'john', balanceDelta: 400 }],
  };

  it('names the player and the kind of operation', () => {
    expect(transactionDescription(mortgage, players)).toBe('John · Mortgage');
    expect(
      transactionDescription(
        {
          ...mortgage,
          type: 'MORTGAGE_REDEMPTION',
          participants: [{ playerId: 'john', balanceDelta: -440 }],
        },
        players,
      ),
    ).toBe('John · Mortgage redeemed');
  });

  it('shows a mortgage as money received', () => {
    expect(transactionAmount(mortgage, 'USD')).toBe('+$400');
  });
});
