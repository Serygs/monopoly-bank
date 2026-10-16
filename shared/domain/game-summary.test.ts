import { describe, expect, it } from 'vitest';
import { calculateFinalGameSummary } from './game-summary.js';
import type { Player, Transaction } from '../types/monopoly.js';
const players: Player[] = ['a', 'b', 'c'].map((id) => ({
  id,
  gameId: 'g',
  name: id,
  color: '#000',
  balance: 0,
  createdAt: '',
}));
const transaction = (
  type: Transaction['type'],
  totalAmount: number,
  participants: Transaction['participants'],
): Transaction => ({
  id: `${type}-${totalAmount}`,
  gameId: 'g',
  type,
  amount: totalAmount,
  totalAmount,
  comment: null,
  createdAt: '',
  participants,
});
describe('calculateFinalGameSummary', () =>
  it('counts global volume once and identifies payer relationships deterministically', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('PLAYER_TO_PLAYER', 50, [
        { playerId: 'a', balanceDelta: -50 },
        { playerId: 'b', balanceDelta: 50 },
      ]),
      transaction('PLAYER_TO_BANK', 20, [{ playerId: 'a', balanceDelta: -20 }]),
      transaction('BANK_TO_PLAYER', 30, [{ playerId: 'c', balanceDelta: 30 }]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(100);
    expect(summary.playerToPlayerTotal).toBe(50);
    expect(summary.paidToBank).toBe(20);
    expect(summary.receivedFromBank).toBe(30);
    expect(summary.biggestPayerRecipient).toMatchObject({
      payerId: 'a',
      recipientId: 'b',
      amount: 50,
    });
  }));

describe('loans in the final summary', () => {
  it('count toward the volume but are neither sent nor received money', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('LOAN_ISSUE', 100, [
        { playerId: 'a', balanceDelta: -100 },
        { playerId: 'b', balanceDelta: 100 },
      ]),
      transaction('LOAN_REPAYMENT', 40, [
        { playerId: 'b', balanceDelta: -40 },
        { playerId: 'a', balanceDelta: 40 },
      ]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(140);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    expect(summary.biggestPayerRecipient).toBeNull();
    for (const metric of summary.players) {
      expect(metric.sent).toBe(0);
      expect(metric.received).toBe(0);
    }
    expect(summary.players.find((metric) => metric.playerId === 'a')?.transactionCount).toBe(2);
  });
});
