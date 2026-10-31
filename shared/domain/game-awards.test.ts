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

  it('marks where a bankrupt player ends, in thinned points too', () => {
    const short = calculateBalanceSeries(
      [
        row('t1', 'BANK_TO_PLAYER', 5, 'b', 5),
        row('t2', 'BANKRUPTCY_TRANSFER', 100, 'a', -100),
        row('t2', 'BANKRUPTCY_TRANSFER', 100, 'b', 100),
        row('t3', 'BANK_TO_PLAYER', 5, 'b', 5),
      ],
      ['a', 'b'],
      100,
    );
    expect(short.players.map((entry) => entry.endIndex)).toEqual([2, undefined]);

    const entries = [
      ...Array.from({ length: 200 }, (_, index) => row(`t${index}`, 'BANK_TO_PLAYER', 1, 'b', 1)),
      row('x', 'BANKRUPTCY_TRANSFER', 100, 'a', -100),
      row('x', 'BANKRUPTCY_TRANSFER', 100, 'b', 100),
      ...Array.from({ length: 200 }, (_, index) => row(`u${index}`, 'BANK_TO_PLAYER', 1, 'b', 1)),
    ];
    const thinned = calculateBalanceSeries(entries, ['a', 'b'], 100).players[0];
    expect(thinned.endIndex).toBeGreaterThan(0);
    expect(thinned.endIndex).toBeLessThan(MAX_SERIES_POINTS - 1);
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

describe('the biggest operation award', () => {
  it('keeps the first of two operations of the same amount', () => {
    const awards = calculateGameAwards([
      row('t1', 'PLAYER_TO_BANK', 100, 'a', -100),
      row('t2', 'PLAYER_TO_BANK', 100, 'b', -100),
    ]);
    expect(awards.biggestOperation).toEqual({ type: 'PLAYER_TO_BANK', amount: 100, playerId: 'a' });
  });

  it('is replaced only by a strictly bigger operation', () => {
    const awards = calculateGameAwards([
      row('t1', 'PLAYER_TO_BANK', 100, 'a', -100),
      row('t2', 'BANK_TO_PLAYER', 101, 'b', 101),
      row('t3', 'PLAYER_TO_BANK', 50, 'c', -50),
    ]);
    expect(awards.biggestOperation).toEqual({ type: 'BANK_TO_PLAYER', amount: 101, playerId: 'b' });
  });

  it('names the payer, or the receiver when there is no payer, or nobody', () => {
    const named = (entries: LedgerEntry[]) => calculateGameAwards(entries).biggestOperation;
    expect(
      named([
        row('t1', 'PLAYER_TO_PLAYER', 50, 'b', 50),
        row('t1', 'PLAYER_TO_PLAYER', 50, 'a', -50),
      ])?.playerId,
    ).toBe('a');
    expect(named([row('t1', 'BANK_TO_PLAYER', 50, 'b', 50)])?.playerId).toBe('b');
    expect(named([row('t1', 'PROPERTY_TRANSFER', 50, 'b', 0)])?.playerId).toBeNull();
  });

  it('does not take a participant with no change for the payer or the receiver', () => {
    const awards = calculateGameAwards([
      row('t1', 'PLAYER_TO_PLAYER', 50, 'z', 0),
      row('t1', 'PLAYER_TO_PLAYER', 50, 'a', -50),
      row('t1', 'PLAYER_TO_PLAYER', 50, 'b', 50),
    ]);
    expect(awards.biggestOperation?.playerId).toBe('a');
    expect(awards.rentPaid).toEqual({ playerId: 'a', amount: 50 });
    expect(awards.rentCollected).toEqual({ playerId: 'b', amount: 50 });
  });

  it('leaves out both kinds of loan transaction', () => {
    const awards = calculateGameAwards([
      row('t1', 'LOAN_REPAYMENT', 900, 'a', -900),
      row('t2', 'LOAN_ISSUE', 800, 'a', 800),
      row('t3', 'PLAYER_TO_BANK', 10, 'a', -10),
    ]);
    expect(awards.biggestOperation).toEqual({ type: 'PLAYER_TO_BANK', amount: 10, playerId: 'a' });
  });
});

describe('the rent awards', () => {
  it('goes to the player with the most money, whatever order the ledger lists them in', () => {
    const awards = calculateGameAwards([
      row('t1', 'PAY_RENT', 100, 'a', -100),
      row('t1', 'PAY_RENT', 100, 'x', 100),
      row('t2', 'PAY_RENT', 50, 'b', -50),
      row('t2', 'PAY_RENT', 50, 'y', 50),
    ]);
    expect(awards.rentPaid).toEqual({ playerId: 'a', amount: 100 });
    expect(awards.rentCollected).toEqual({ playerId: 'x', amount: 100 });
    const reversed = calculateGameAwards([
      row('t2', 'PAY_RENT', 50, 'a', -50),
      row('t2', 'PAY_RENT', 50, 'x', 50),
      row('t1', 'PAY_RENT', 100, 'b', -100),
      row('t1', 'PAY_RENT', 100, 'y', 100),
    ]);
    expect(reversed.rentPaid).toEqual({ playerId: 'b', amount: 100 });
    expect(reversed.rentCollected).toEqual({ playerId: 'y', amount: 100 });
  });

  it('breaks a tie in favour of the lower player id', () => {
    const awards = calculateGameAwards([
      row('t1', 'PAY_RENT', 70, 'b', -70),
      row('t1', 'PAY_RENT', 70, 'd', 70),
      row('t2', 'PAY_RENT', 70, 'a', -70),
      row('t2', 'PAY_RENT', 70, 'c', 70),
    ]);
    expect(awards.rentPaid).toEqual({ playerId: 'a', amount: 70 });
    expect(awards.rentCollected).toEqual({ playerId: 'c', amount: 70 });
  });

  it('ignores payments that moved no money', () => {
    const awards = calculateGameAwards([
      row('t1', 'PAY_RENT', 0, 'a', -1),
      row('t1', 'PAY_RENT', 0, 'b', 1),
    ]);
    expect(awards.rentPaid).toBeNull();
    expect(awards.rentCollected).toBeNull();
  });

  it('does not count bank payments or loans as rent', () => {
    const awards = calculateGameAwards([
      row('t1', 'PLAYER_TO_BANK', 100, 'a', -100),
      row('t2', 'BANK_TO_PLAYER', 100, 'b', 100),
      row('t3', 'LOAN_ISSUE', 100, 'b', -100),
      row('t3', 'LOAN_ISSUE', 100, 'a', 100),
    ]);
    expect(awards.rentPaid).toBeNull();
    expect(awards.rentCollected).toBeNull();
  });

  it('counts a payment that lists only one side', () => {
    expect(
      calculateGameAwards([row('t1', 'PLAYER_TO_PLAYER', 30, 'a', -30)]).rentCollected,
    ).toBeNull();
    expect(calculateGameAwards([row('t1', 'PLAYER_TO_PLAYER', 30, 'a', -30)]).rentPaid).toEqual({
      playerId: 'a',
      amount: 30,
    });
    expect(calculateGameAwards([row('t1', 'PAY_RENT', 30, 'b', 30)]).rentPaid).toBeNull();
    expect(calculateGameAwards([row('t1', 'PAY_RENT', 30, 'b', 30)]).rentCollected).toEqual({
      playerId: 'b',
      amount: 30,
    });
  });
});

describe('the best auction deal award', () => {
  it('keeps the cheapest deal whichever comes first and keeps the first of equal prices', () => {
    const cheapFirst = calculateGameAwards([
      row('t1', 'AUCTION_PAYMENT', 150, 'a', -150, 'Cheap'),
      row('t2', 'AUCTION_PAYMENT', 400, 'b', -400, 'Dear'),
      row('t3', 'AUCTION_PAYMENT', 150, 'c', -150, 'Same'),
    ]);
    expect(cheapFirst.bestAuctionDeal).toEqual({ playerId: 'a', amount: 150, label: 'Cheap' });
  });

  it('ignores other transaction types, even cheaper ones', () => {
    const awards = calculateGameAwards([
      row('t1', 'AUCTION_PAYMENT', 400, 'a', -400, 'Lot'),
      row('t2', 'PLAYER_TO_BANK', 10, 'b', -10),
    ]);
    expect(awards.bestAuctionDeal).toEqual({ playerId: 'a', amount: 400, label: 'Lot' });
    expect(
      calculateGameAwards([row('t2', 'PLAYER_TO_BANK', 10, 'b', -10)]).bestAuctionDeal,
    ).toBeNull();
  });

  it('needs a paying player', () => {
    expect(
      calculateGameAwards([row('t1', 'AUCTION_PAYMENT', 400, 'a', 400, 'Lot')]).bestAuctionDeal,
    ).toBeNull();
  });

  it('carries no label for an auction without a comment', () => {
    expect(
      calculateGameAwards([row('t1', 'AUCTION_PAYMENT', 400, 'a', -400)]).bestAuctionDeal,
    ).toEqual({ playerId: 'a', amount: 400, label: null });
  });
});

describe('the biggest loan award', () => {
  it('keeps the biggest loan and the first of equal amounts', () => {
    const awards = calculateGameAwards([
      row('t1', 'LOAN_ISSUE', 300, 'a', 300),
      row('t2', 'LOAN_ISSUE', 100, 'b', 100),
      row('t3', 'LOAN_ISSUE', 300, 'c', 300),
    ]);
    expect(awards.biggestLoan).toEqual({ playerId: 'a', amount: 300 });
    const bigger = calculateGameAwards([
      row('t1', 'LOAN_ISSUE', 100, 'a', 100),
      row('t2', 'LOAN_ISSUE', 301, 'b', 301),
    ]);
    expect(bigger.biggestLoan).toEqual({ playerId: 'b', amount: 301 });
  });

  it('is about borrowers only', () => {
    expect(
      calculateGameAwards([row('t1', 'BANK_TO_PLAYER', 900, 'a', 900)]).biggestLoan,
    ).toBeNull();
    expect(calculateGameAwards([row('t1', 'LOAN_ISSUE', 900, 'a', -900)]).biggestLoan).toBeNull();
  });
});

describe('the balance series thinning boundary', () => {
  const steps = (count: number) =>
    calculateBalanceSeries(
      Array.from({ length: count }, (_, index) => row(`t${index}`, 'BANK_TO_PLAYER', 1, 'a', 1)),
      ['a'],
      0,
    );

  it('keeps every point when they fit exactly', () => {
    const series = steps(MAX_SERIES_POINTS - 1);
    expect(series.steps).toBe(MAX_SERIES_POINTS - 1);
    expect(series.players[0]?.balances).toEqual(
      Array.from({ length: MAX_SERIES_POINTS }, (_, index) => index),
    );
  });

  it('thins to the maximum as soon as one more point would not fit', () => {
    const series = steps(MAX_SERIES_POINTS);
    expect(series.players[0]?.balances).toHaveLength(MAX_SERIES_POINTS);
    expect(series.players[0]?.balances.at(-1)).toBe(MAX_SERIES_POINTS);
  });

  it('gives a player with no transactions a flat line and an empty game one point', () => {
    const series = calculateBalanceSeries(
      [row('t1', 'BANK_TO_PLAYER', 5, 'a', 5)],
      ['a', 'b'],
      100,
    );
    expect(series.players[1]).toEqual({ playerId: 'b', balances: [100, 100] });
    expect(calculateBalanceSeries([], ['a'], 100)).toEqual({
      steps: 0,
      players: [{ playerId: 'a', balances: [100] }],
    });
  });

  it('applies several rows of one transaction as a single step', () => {
    const series = calculateBalanceSeries(
      [
        row('t1', 'PLAYER_TO_PLAYER', 5, 'a', -5),
        row('t1', 'PLAYER_TO_PLAYER', 5, 'b', 5),
        row('t2', 'BANK_TO_PLAYER', 7, 'b', 7),
      ],
      ['a', 'b'],
      10,
    );
    expect(series.steps).toBe(2);
    expect(series.players).toEqual([
      { playerId: 'a', balances: [10, 5, 5] },
      { playerId: 'b', balances: [10, 15, 22] },
    ]);
  });

  it('ignores rows of a player outside the requested list', () => {
    const series = calculateBalanceSeries([row('t1', 'BANK_TO_PLAYER', 5, 'ghost', 5)], ['a'], 10);
    expect(series.players).toEqual([{ playerId: 'a', balances: [10, 10] }]);
  });
});
