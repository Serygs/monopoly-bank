import { describe, expect, it } from 'vitest';
import type { Loan, Transaction, TransactionType } from '../types/monopoly.js';
import { bankLoanInterest, isInterestRatePercent } from './bank-loan.js';
import {
  bankLoanCooldowns,
  loanRoundStatus,
  suggestedRatePercent,
  transactionActor,
  turnsStartedSince,
  withLoanRounds,
} from './round-tracking.js';

let counter = 0;

/** A minimal chronological transaction: `deltas` maps player id to balance delta. */
function tx(
  type: TransactionType,
  deltas: Record<string, number>,
  overrides: Partial<Transaction> = {},
): Transaction {
  counter += 1;
  return {
    id: `t${counter}`,
    gameId: 'game',
    type,
    amount: 1,
    totalAmount: 1,
    comment: null,
    createdAt: '',
    participants: Object.entries(deltas).map(([playerId, balanceDelta]) => ({
      playerId,
      balanceDelta,
    })),
    ...overrides,
  };
}

const none = new Set<string>();
const pays = (payer: string) => tx('PLAYER_TO_BANK', { [payer]: -10 });
const receives = (player: string) => tx('BANK_TO_PLAYER', { [player]: 10 });
const borrow = (player: string) => tx('LOAN_ISSUE', { [player]: 100 });

describe('transactionActor', () => {
  it.each([
    [tx('PLAYER_TO_PLAYER', { a: -10, b: 10 }), 'a'],
    [tx('PAY_RENT', { a: -10, b: 10 }), 'a'],
    [tx('PLAYER_TO_BANK', { a: -10 }), 'a'],
    [tx('PLAYER_TO_ALL', { a: -20, b: 10, c: 10 }), 'a'],
    [tx('BANK_TO_PLAYER', { a: 10 }), 'a'],
    [tx('PASS_GO', { a: 200 }), 'a'],
    [tx('ALL_TO_PLAYER', { a: 20, b: -10, c: -10 }), 'a'],
  ] as const)('names the payer or recipient of %o', (transaction, expected) => {
    expect(transactionActor(transaction)).toBe(expected);
  });

  it.each([
    tx('LOAN_ISSUE', { a: 100 }),
    tx('LOAN_REPAYMENT', { a: -100 }),
    tx('MORTGAGE', { a: 100 }),
    tx('MORTGAGE_REDEMPTION', { a: -110 }),
    tx('REVERSAL', { a: 10 }),
    tx('BANKRUPTCY_TRANSFER', { a: -10, b: 10 }),
  ])('ignores a %o', (transaction) => {
    expect(transactionActor(transaction)).toBeNull();
  });

  it('ignores a reversed transaction', () => {
    expect(
      transactionActor(tx('BANK_TO_PLAYER', { a: 10 }, { reversedByTransactionId: 'r' })),
    ).toBeNull();
  });
});

describe('turnsStartedSince', () => {
  it('does not count the turn the anchor itself happened in', () => {
    const anchor = borrow('a');
    const log = [anchor, pays('a'), receives('a')];

    expect(turnsStartedSince(log, anchor.id, 'a')).toBe(0);
  });

  it('counts each time the player acts again after somebody else acted', () => {
    const anchor = borrow('a');
    const log = [
      anchor,
      pays('a'),
      pays('b'),
      pays('b'),
      pays('a'),
      pays('a'),
      pays('c'),
      pays('a'),
    ];

    expect(turnsStartedSince(log, anchor.id, 'a')).toBe(2);
    expect(turnsStartedSince(log, anchor.id, 'b')).toBe(1);
    expect(turnsStartedSince(log, anchor.id, 'c')).toBe(1);
  });

  it('counts the borrower acting first after somebody else took the anchor turn', () => {
    // b borrowed during a's turn: a is the leading run, so b's next action is the first turn start.
    const anchor = borrow('b');
    const log = [anchor, pays('a'), pays('b')];

    expect(turnsStartedSince(log, anchor.id, 'b')).toBe(1);
  });

  it('skips transactions that carry no actor', () => {
    const anchor = borrow('a');
    const log = [
      anchor,
      pays('a'),
      tx('MORTGAGE', { b: 60 }),
      tx('LOAN_REPAYMENT', { c: -10 }),
      tx('BANKRUPTCY_TRANSFER', { c: -5 }),
      pays('a'),
      pays('b'),
    ];

    expect(turnsStartedSince(log, anchor.id, 'b')).toBe(1);
    expect(turnsStartedSince(log, anchor.id, 'a')).toBe(0);
  });

  it('ignores a reversed transaction, so it neither starts nor ends a turn', () => {
    const anchor = borrow('a');
    const log = [
      anchor,
      pays('a'),
      tx('PLAYER_TO_BANK', { b: -10 }, { reversedByTransactionId: 'rev' }),
      tx('REVERSAL', { b: 10 }, { reversesTransactionId: 'x' }),
      pays('a'),
    ];

    expect(turnsStartedSince(log, anchor.id, 'a')).toBe(0);
  });

  it('keeps counting the earlier turns of a player who later went bankrupt', () => {
    const anchor = borrow('a');
    const log = [anchor, pays('a'), pays('b'), pays('a')];

    expect(turnsStartedSince(log, anchor.id, 'a')).toBe(1);
  });

  it('is zero when the anchor is not in the log', () => {
    expect(turnsStartedSince([pays('a'), pays('b'), pays('a')], 'missing', 'a')).toBe(0);
  });
});

describe('loan rounds', () => {
  const loan: Pick<Loan, 'id' | 'borrowerPlayerId'> = { id: 'x', borrowerPlayerId: 'a' };

  it.each([
    [1, 0],
    [2, 10],
    [3, 20],
    [4, 20],
    [9, 20],
  ] as const)('suggests the rate for round %i', (round, rate) => {
    expect(suggestedRatePercent(round)).toBe(rate);
  });

  it('starts in round 1 at 0%, reaches round 2 at 10% and is overdue from round 4', () => {
    const anchor = borrow('a');
    anchor.id = 'x';
    const turn = (): Transaction[] => [pays('b'), pays('a')];

    expect(loanRoundStatus([anchor, pays('a')], loan)).toEqual({
      round: 1,
      suggestedRatePercent: 0,
      overdue: false,
    });
    expect(loanRoundStatus([anchor, pays('a'), ...turn()], loan)).toEqual({
      round: 2,
      suggestedRatePercent: 10,
      overdue: false,
    });
    expect(loanRoundStatus([anchor, pays('a'), ...turn(), ...turn()], loan)).toMatchObject({
      round: 3,
      suggestedRatePercent: 20,
      overdue: false,
    });
    expect(loanRoundStatus([anchor, pays('a'), ...turn(), ...turn(), ...turn()], loan)).toEqual({
      round: 4,
      suggestedRatePercent: 20,
      overdue: true,
    });
  });

  it('only adds rounds to active bank loans', () => {
    const anchor = borrow('a');
    anchor.id = 'bank';
    const base = {
      gameId: 'game',
      principal: 100,
      repaidAmount: 0,
      state: 'ACTIVE' as const,
      createdAt: '',
      closedAt: null,
    };
    const bank: Loan = {
      ...base,
      id: 'bank',
      lenderKind: 'BANK',
      lenderPlayerId: null,
      borrowerPlayerId: 'a',
    };
    const player: Loan = {
      ...base,
      id: 'player',
      lenderKind: 'PLAYER',
      lenderPlayerId: 'b',
      borrowerPlayerId: 'a',
    };

    const [withRounds, untouched] = withLoanRounds([bank, player], [anchor]);

    expect(withRounds?.rounds).toEqual({ round: 1, suggestedRatePercent: 0, overdue: false });
    expect(untouched).toBe(player);
  });
});

describe('bankLoanCooldowns', () => {
  it('waits two turn starts after the repayment, then clears', () => {
    const repayment = tx('LOAN_REPAYMENT', { a: -100 });
    const repayments = [{ playerId: 'a', transactionId: repayment.id }];
    const log = [repayment, pays('a')];

    expect(bankLoanCooldowns(repayments, log, none)).toEqual([{ playerId: 'a', roundsLeft: 2 }]);

    log.push(pays('b'), pays('a'));
    expect(bankLoanCooldowns(repayments, log, none)).toEqual([{ playerId: 'a', roundsLeft: 1 }]);

    log.push(pays('b'), pays('a'));
    expect(bankLoanCooldowns(repayments, log, none)).toEqual([]);
  });

  it('only the latest repayment of a player matters, and several players are tracked apart', () => {
    const first = tx('LOAN_REPAYMENT', { a: -100 });
    const second = tx('LOAN_REPAYMENT', { a: -100 });
    const other = tx('LOAN_REPAYMENT', { b: -100 });
    const log = [
      first,
      pays('b'),
      pays('a'),
      pays('b'),
      pays('a'),
      second,
      other,
      pays('c'),
      pays('a'),
    ];

    expect(
      bankLoanCooldowns(
        [
          { playerId: 'a', transactionId: first.id },
          { playerId: 'b', transactionId: other.id },
          { playerId: 'a', transactionId: second.id },
        ],
        log,
        none,
      ),
    ).toEqual([
      { playerId: 'a', roundsLeft: 1 },
      { playerId: 'b', roundsLeft: 2 },
    ]);
  });

  it('does not put a bankrupt player in a cooldown', () => {
    const repayment = tx('LOAN_REPAYMENT', { a: -100 });

    expect(
      bankLoanCooldowns(
        [{ playerId: 'a', transactionId: repayment.id }],
        [repayment],
        new Set(['a']),
      ),
    ).toEqual([]);
  });
});

describe('bankLoanInterest', () => {
  it.each([
    [200, 0, 0],
    [200, 10, 20],
    [200, 20, 40],
    [5, 10, 1], // 0.5 rounds half up
    [4, 10, 0], // 0.4
    [14, 10, 1], // 1.4
    [15, 10, 2], // 1.5
    [7, 20, 1], // 1.4
    [1, 20, 0], // 0.2
  ] as const)('charges %i at %i%% as %i', (principal, rate, interest) => {
    expect(bankLoanInterest(principal, rate)).toBe(interest);
  });

  it('refuses a principal whose interest is not exact', () => {
    expect(() => bankLoanInterest(Number.MAX_SAFE_INTEGER, 20)).toThrow(RangeError);
    expect(() => bankLoanInterest(0, 10)).toThrow(RangeError);
  });

  it('recognizes only the three offered rates', () => {
    expect([0, 10, 20].every(isInterestRatePercent)).toBe(true);
    expect([5, '10', null, undefined, 30].some(isInterestRatePercent)).toBe(false);
  });
});
