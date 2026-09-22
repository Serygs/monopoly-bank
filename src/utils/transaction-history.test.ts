import { describe, expect, it } from 'vitest';
import type { Player, Transaction, TransactionType } from '../../shared/types/monopoly';
import { playerTransactionAmount, transactionAmount, transactionDescription } from './transaction-history';

const players: Player[] = [{ id: 'john', gameId: 'game', name: 'John', color: '#111', balance: 800, createdAt: '' }, { id: 'alex', gameId: 'game', name: 'Alex', color: '#222', balance: 1200, createdAt: '' }];
const rent: Transaction = { id: 'transaction', gameId: 'game', type: 'PAY_RENT', amount: 120, totalAmount: 120, comment: null, createdAt: '', participants: [{ playerId: 'john', balanceDelta: -120 }, { playerId: 'alex', balanceDelta: 120 }] };
const bankTransaction = (type: TransactionType, delta: number): Transaction => ({ ...rent, type, amount: Math.abs(delta), totalAmount: Math.abs(delta), participants: [{ playerId: 'john', balanceDelta: delta }] });

describe('transaction history formatting', () => {
  it('formats a rent payment with both player names', () => { expect(transactionDescription(rent, players)).toBe('John → Alex · Rent'); });
  it('formats transaction descriptions in Ukrainian', () => { expect(transactionDescription(rent, players, 'uk')).toBe('John → Alex · Оренда'); });
  it('formats multi-player amounts and player-relative values', () => {
    const transaction: Transaction = { ...rent, type: 'PLAYER_TO_ALL', amount: 50, totalAmount: 200 };
    expect(transactionAmount(transaction, 'K')).toBe('50k each · 200k total');
    expect(playerTransactionAmount(rent, 'john', 'K')).toBe('-120k');
    expect(playerTransactionAmount(rent, 'alex', 'K')).toBe('+120k');
  });

  const boardTypes: TransactionType[] = ['PROPERTY_PURCHASE', 'PROPERTY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDINGS', 'PROPERTY_MORTGAGE', 'PROPERTY_UNMORTGAGE', 'PROPERTY_AUCTION', 'PROPERTY_TRADE', 'JAIL_BAIL'];
  it('gives each of the nine board transaction types its own label in both languages', () => {
    for (const language of ['en', 'uk'] as const) {
      const descriptions = boardTypes.map((type) => transactionDescription(type === 'PROPERTY_RENT' || type === 'PROPERTY_TRADE' ? { ...rent, type } : bankTransaction(type, type === 'PROPERTY_SELL_BUILDINGS' || type === 'PROPERTY_MORTGAGE' ? 60 : -60), players, language));
      expect(new Set(descriptions).size).toBe(boardTypes.length);
      for (const description of descriptions) expect(description).toMatch(/ · /u);
    }
    expect(transactionDescription(bankTransaction('PROPERTY_PURCHASE', -60), players)).toBe('John → Bank · Bought a deed');
    expect(transactionDescription(bankTransaction('PROPERTY_MORTGAGE', 30), players, 'uk')).toBe('Банк → John · Застава поля');
    expect(transactionDescription({ ...rent, type: 'PROPERTY_RENT' }, players, 'uk')).toBe('John → Alex · Оренда');
    expect(transactionDescription({ ...rent, type: 'PROPERTY_TRADE', participants: [] }, players)).toBe('Trade settled');
    expect(transactionDescription(bankTransaction('JAIL_BAIL', -50), players)).toBe('John → Bank · Paid jail bail');
  });

  it('shows per-building and total figures for a multi-house build', () => {
    const build: Transaction = { ...bankTransaction('PROPERTY_BUILD', -300), amount: 100, totalAmount: 300 };
    expect(transactionAmount(build, 'USD')).toBe('$100 each · $300 total');
    expect(transactionAmount({ ...build, amount: 100, totalAmount: 100 }, 'USD')).toBe('$100');
  });
});
