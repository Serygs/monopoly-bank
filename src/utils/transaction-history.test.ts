import { describe, expect, it } from 'vitest';
import type { Player, Transaction } from '../../shared/types/monopoly';
import { playerTransactionAmount, transactionAmount, transactionDescription } from './transaction-history';

const players: Player[] = [{ id: 'john', gameId: 'game', name: 'John', color: '#111', balance: 800, createdAt: '' }, { id: 'alex', gameId: 'game', name: 'Alex', color: '#222', balance: 1200, createdAt: '' }];
const rent: Transaction = { id: 'transaction', gameId: 'game', type: 'PAY_RENT', amount: 120, totalAmount: 120, comment: null, createdAt: '', participants: [{ playerId: 'john', balanceDelta: -120 }, { playerId: 'alex', balanceDelta: 120 }] };

describe('transaction history formatting', () => {
  it('formats a rent payment with both player names', () => { expect(transactionDescription(rent, players)).toBe('John → Alex · Rent'); });
  it('formats transaction descriptions in Ukrainian', () => { expect(transactionDescription(rent, players, 'uk')).toBe('John → Alex · Оренда'); });
  it('formats multi-player amounts and player-relative values', () => {
    const transaction: Transaction = { ...rent, type: 'PLAYER_TO_ALL', amount: 50, totalAmount: 200 };
    expect(transactionAmount(transaction, 'K')).toBe('50k each · 200k total');
    expect(playerTransactionAmount(rent, 'john', 'K')).toBe('-120k');
    expect(playerTransactionAmount(rent, 'alex', 'K')).toBe('+120k');
  });
});
