import { describe, expect, it } from 'vitest';
import {
  calculateBalanceSeries,
  calculateGameAwards,
  MAX_SERIES_POINTS,
  type LedgerEntry,
} from './game-awards.js';

const row = (
  transactionId: string,
  type: LedgerEntry['type'],
  totalAmount: number,
  playerId: string,
  balanceDelta: number,
  comment: string | null = null,
): LedgerEntry => ({ transactionId, type, totalAmount, comment, playerId, balanceDelta });

describe('calculateGameAwards', () => {
  it('is empty for an empty ledger', () => {
    expect(calculateGameAwards([])).toEqual({
      biggestOperation: null,
      rentPaid: null,
      rentCollected: null,
      bestAuctionDeal: null,
      biggestLoan: null,
    });
  });

  it('sums player-to-player payments per payer and receiver and ignores loans for the biggest operation', () => {
    const awards = calculateGameAwards([
      row('t1', 'PLAYER_TO_PLAYER', 100, 'a', -100),
      row('t1', 'PLAYER_TO_PLAYER', 100, 'b', 100),
      row('t2', 'PAY_RENT', 250, 'a', -250),
      row('t2', 'PAY_RENT', 250, 'c', 250),
      row('t3', 'LOAN_ISSUE', 900, 'c', 900),
      row('t3', 'LOAN_ISSUE', 900, 'a', -900),
    ]);
    expect(awards.rentPaid).toEqual({ playerId: 'a', amount: 350 });
    expect(awards.rentCollected).toEqual({ playerId: 'c', amount: 250 });
    expect(awards.biggestOperation).toEqual({ type: 'PAY_RENT', amount: 250, playerId: 'a' });
    expect(awards.biggestLoan).toEqual({ playerId: 'c', amount: 900 });
  });

  it('picks the cheapest auction win as the best deal and keeps the lot name', () => {
    const awards = calculateGameAwards([
      row('t1', 'AUCTION_PAYMENT', 400, 'a', -400, 'Park Lane'),
      row('t2', 'AUCTION_PAYMENT', 150, 'b', -150, 'Old Kent Road'),
    ]);
    expect(awards.bestAuctionDeal).toEqual({
      playerId: 'b',
      amount: 150,
      label: 'Old Kent Road',
    });
  });
});

describe('calculateBalanceSeries', () => {
  it('starts at the starting balance and applies each transaction in order', () => {
    const series = calculateBalanceSeries(
      [row('t1', 'PLAYER_TO_PLAYER', 50, 'a', -50), row('t1', 'PLAYER_TO_PLAYER', 50, 'b', 50)],
      ['a', 'b'],
      1000,
    );
    expect(series).toEqual({
      steps: 1,
      players: [
        { playerId: 'a', balances: [1000, 950] },
        { playerId: 'b', balances: [1000, 1050] },
      ],
    });
  });

  it('thins a long game to a bounded number of points that still end on the final balance', () => {
    const entries = Array.from({ length: 500 }, (_, index) =>
      row(`t${index}`, 'BANK_TO_PLAYER', 1, 'a', 1),
    );
    const [player] = calculateBalanceSeries(entries, ['a'], 0).players;
    expect(player.balances).toHaveLength(MAX_SERIES_POINTS);
    expect(player.balances[0]).toBe(0);
    expect(player.balances.at(-1)).toBe(500);
  });
});

describe('trades in the awards', () => {
  it('never makes a zero-money trade the biggest operation', () => {
    expect(
      calculateGameAwards([
        row('t1', 'PROPERTY_TRANSFER', 0, 'a', 0),
        row('t1', 'PROPERTY_TRANSFER', 0, 'b', 0),
      ]).biggestOperation,
    ).toBeNull();
    expect(
      calculateGameAwards([
        row('t1', 'PROPERTY_TRANSFER', 0, 'a', 0),
        row('t2', 'PLAYER_TO_BANK', 40, 'a', -40),
      ]).biggestOperation,
    ).toEqual({ type: 'PLAYER_TO_BANK', amount: 40, playerId: 'a' });
  });
});
