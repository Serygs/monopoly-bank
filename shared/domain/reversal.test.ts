import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types/monopoly.js';
import {
  canReverseTransaction,
  findReversalDependency,
  isReversibleType,
  isWithinReversalWindow,
  REVERSAL_WINDOW_MS,
  reversalAvailability,
  reversalInitiatorPlayerId,
  reversibleTransaction,
  transactionTimeMs,
} from './reversal.js';

const participants = (...deltas: [string, number][]) =>
  deltas.map(([playerId, balanceDelta]) => ({ playerId, balanceDelta }));

describe('reversalInitiatorPlayerId', () => {
  it('is the payer of an outgoing payment', () => {
    for (const type of ['PLAYER_TO_PLAYER', 'PAY_RENT'] as const)
      expect(
        reversalInitiatorPlayerId({ type, participants: participants(['a', -5], ['b', 5]) }),
      ).toBe('a');
    expect(
      reversalInitiatorPlayerId({
        type: 'PLAYER_TO_BANK',
        participants: participants(['a', -5]),
      }),
    ).toBe('a');
    expect(
      reversalInitiatorPlayerId({
        type: 'PLAYER_TO_ALL',
        participants: participants(['a', -10], ['b', 5], ['c', 5]),
      }),
    ).toBe('a');
  });

  it('is the receiving player of money paid in', () => {
    expect(
      reversalInitiatorPlayerId({ type: 'BANK_TO_PLAYER', participants: participants(['a', 5]) }),
    ).toBe('a');
    expect(
      reversalInitiatorPlayerId({ type: 'PASS_GO', participants: participants(['a', 200]) }),
    ).toBe('a');
    expect(
      reversalInitiatorPlayerId({
        type: 'ALL_TO_PLAYER',
        participants: participants(['a', 10], ['b', -5], ['c', -5]),
      }),
    ).toBe('a');
  });

  it('is nobody for records that cannot be reversed or have no single player', () => {
    expect(
      reversalInitiatorPlayerId({
        type: 'BANKRUPTCY_TRANSFER',
        participants: participants(['a', -5], ['b', 5]),
      }),
    ).toBeNull();
    expect(
      reversalInitiatorPlayerId({
        type: 'PLAYER_TO_PLAYER',
        participants: participants(['a', -5], ['b', -5]),
      }),
    ).toBeNull();
  });
});

describe('reversal window', () => {
  it('reads D1 timestamps as UTC and ISO timestamps as they are', () => {
    expect(transactionTimeMs('2026-01-01 10:00:00')).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
    expect(transactionTimeMs('2026-01-01T10:00:00.000Z')).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
  });

  it('closes after the window and rejects unreadable times', () => {
    const created = '2026-01-01 10:00:00';
    const start = transactionTimeMs(created);
    expect(isWithinReversalWindow(created, start + REVERSAL_WINDOW_MS)).toBe(true);
    expect(isWithinReversalWindow(created, start + REVERSAL_WINDOW_MS + 1)).toBe(false);
    expect(isWithinReversalWindow('not a time', start)).toBe(false);
  });

  it('knows which types can be undone', () => {
    expect(isReversibleType('PLAYER_TO_PLAYER')).toBe(true);
    expect(isReversibleType('PASS_GO')).toBe(true);
    expect(isReversibleType('REVERSAL')).toBe(false);
    expect(isReversibleType('BANKRUPTCY_TRANSFER')).toBe(false);
    expect(isReversibleType('LOAN_ISSUE')).toBe(false);
    expect(isReversibleType('LOAN_REPAYMENT')).toBe(false);
    expect(isReversibleType('TO_JACKPOT')).toBe(false);
    expect(isReversibleType('JACKPOT_PAYOUT')).toBe(false);
  });
});

describe('reversibleTransaction', () => {
  it('lets a board mortgage and redemption be undone but not a free-text one', () => {
    for (const type of ['MORTGAGE', 'MORTGAGE_REDEMPTION'] as const) {
      expect(reversibleTransaction({ type, tileId: 'zhitna' })).toBe(true);
      expect(reversibleTransaction({ type })).toBe(false);
      expect(reversibleTransaction({ type, tileId: null })).toBe(false);
    }
  });

  it('follows the type for everything else', () => {
    expect(reversibleTransaction({ type: 'PROPERTY_PURCHASE', tileId: 'zhitna' })).toBe(true);
    expect(reversibleTransaction({ type: 'LOAN_ISSUE', tileId: 'zhitna' })).toBe(false);
  });

  it('names the player who mortgaged or redeemed as the initiator', () => {
    expect(
      reversalInitiatorPlayerId({ type: 'MORTGAGE', participants: participants(['a', 5]) }),
    ).toBe('a');
    expect(
      reversalInitiatorPlayerId({
        type: 'MORTGAGE_REDEMPTION',
        participants: participants(['a', -5]),
      }),
    ).toBe('a');
  });
});

describe('canReverseTransaction', () => {
  const base = {
    id: 't',
    gameId: 'g',
    type: 'PLAYER_TO_PLAYER' as const,
    amount: 5,
    totalAmount: 5,
    comment: null,
    createdAt: '2026-01-01 10:00:00',
    participants: participants(['a', -5], ['b', 5]),
  };
  const start = transactionTimeMs(base.createdAt);

  it('offers the owner every reversible, not yet reversed transaction at any time', () => {
    const input = { isOwner: true, controlledPlayerIds: [], now: start + 10 * REVERSAL_WINDOW_MS };
    expect(canReverseTransaction({ ...input, transaction: base })).toBe(true);
    expect(canReverseTransaction({ ...input, transaction: { ...base, type: 'REVERSAL' } })).toBe(
      false,
    );
    expect(
      canReverseTransaction({
        ...input,
        transaction: { ...base, reversedByTransactionId: 'later' },
      }),
    ).toBe(false);
  });

  it('never offers a pot payment or collection, not even to the owner', () => {
    const input = { isOwner: true, controlledPlayerIds: ['a'], now: start + 1000 };
    for (const [type, deltas] of [
      ['TO_JACKPOT', participants(['a', -5])],
      ['JACKPOT_PAYOUT', participants(['a', 5])],
    ] as const) {
      const transaction = { ...base, type, participants: deltas };
      expect(canReverseTransaction({ ...input, transaction })).toBe(false);
      expect(canReverseTransaction({ ...input, isOwner: false, transaction })).toBe(false);
      expect(reversalInitiatorPlayerId(transaction)).toBeNull();
    }
  });

  it('offers a player only their own transactions, and only within the window', () => {
    const own = { isOwner: false, controlledPlayerIds: ['a'], transaction: base };
    expect(canReverseTransaction({ ...own, now: start + 1000 })).toBe(true);
    expect(canReverseTransaction({ ...own, now: start + REVERSAL_WINDOW_MS + 1 })).toBe(false);
    expect(canReverseTransaction({ ...own, controlledPlayerIds: ['b'], now: start + 1000 })).toBe(
      false,
    );
  });
});

describe('reversal dependencies', () => {
  const tx = (
    id: string,
    type: Transaction['type'],
    list: [string, number][],
    extra: Partial<Transaction> = {},
  ): Transaction => ({
    id,
    gameId: 'g',
    type,
    amount: 1,
    totalAmount: 1,
    comment: null,
    createdAt: '2026-01-01 10:00:00',
    participants: participants(...list),
    ...extra,
  });
  const payment = tx('pay', 'PLAYER_TO_PLAYER', [
    ['a', -50],
    ['b', 50],
  ]);

  it('finds a later mortgage, loan or auction payment by the same players', () => {
    const mortgage = tx('m', 'MORTGAGE', [['b', 100]]);
    expect(findReversalDependency(payment, [mortgage])).toBe(mortgage);
    for (const type of ['LOAN_ISSUE', 'LOAN_REPAYMENT', 'AUCTION_PAYMENT'] as const)
      expect(findReversalDependency(payment, [tx('x', type, [['a', -1]])])?.id).toBe('x');
  });

  it('blocks reversing a purchase once rent was paid on the same tile', () => {
    const purchase = tx('buy', 'PROPERTY_PURCHASE', [['a', -50]], { tileId: 'arbat' });
    const rent = tx(
      'rent',
      'PAY_RENT',
      [
        ['c', -5],
        ['d', 5],
      ],
      { tileId: 'arbat' },
    );
    expect(findReversalDependency(purchase, [rent])).toBe(rent);
    expect(
      findReversalDependency(purchase, [
        tx(
          'r2',
          'PAY_RENT',
          [
            ['c', -5],
            ['d', 5],
          ],
          { tileId: 'zhitna' },
        ),
      ]),
    ).toBeNull();
  });

  it('ignores other players, ordinary payments and operations that were reversed', () => {
    expect(findReversalDependency(payment, [tx('m', 'MORTGAGE', [['c', 100]])])).toBeNull();
    expect(findReversalDependency(payment, [tx('p', 'PLAYER_TO_BANK', [['a', -1]])])).toBeNull();
    expect(
      findReversalDependency(payment, [
        tx('r', 'AUCTION_PAYMENT', [['a', -5]], { reversedByTransactionId: 'rev' }),
      ]),
    ).toBeNull();
  });

  it('reports why a viewer who made the payment cannot reverse it', () => {
    const base = { transaction: payment, isOwner: false, controlledPlayerIds: ['a'] };
    const now = transactionTimeMs(payment.createdAt) + 1000;
    expect(reversalAvailability({ ...base, now })).toEqual({ status: 'allowed' });
    expect(reversalAvailability({ ...base, now: now + REVERSAL_WINDOW_MS })).toMatchObject({
      status: 'blocked',
      reason: 'WINDOW_EXPIRED',
    });
    expect(
      reversalAvailability({ ...base, now, later: [tx('m', 'MORTGAGE', [['a', 1]])] }),
    ).toMatchObject({ status: 'blocked', reason: 'LATER_OPERATION' });
    expect(reversalAvailability({ ...base, controlledPlayerIds: ['z'], now })).toEqual({
      status: 'hidden',
    });
  });
});

describe('reversalInitiatorPlayerId for every transaction type', () => {
  it.each([
    'PLAYER_TO_PLAYER',
    'PAY_RENT',
    'PLAYER_TO_BANK',
    'MORTGAGE_REDEMPTION',
    'PROPERTY_BUILD',
    'AUCTION_PAYMENT',
    'PROPERTY_PURCHASE',
    'PLAYER_TO_ALL',
  ] as const)('%s is made by the single player who paid', (type) => {
    expect(reversalInitiatorPlayerId({ type, participants: participants(['a', -5]) })).toBe('a');
  });

  it.each([
    'BANK_TO_PLAYER',
    'PASS_GO',
    'MORTGAGE',
    'PROPERTY_SELL_BUILDING',
    'ALL_TO_PLAYER',
  ] as const)('%s is made by the single player who received', (type) => {
    expect(reversalInitiatorPlayerId({ type, participants: participants(['a', 5]) })).toBe('a');
  });

  it.each([
    'BANKRUPTCY_TRANSFER',
    'REVERSAL',
    'LOAN_ISSUE',
    'LOAN_REPAYMENT',
    'TO_JACKPOT',
    'JACKPOT_PAYOUT',
  ] as const)('%s has no initiator whoever took part', (type) => {
    expect(
      reversalInitiatorPlayerId({ type, participants: participants(['a', -5], ['b', 5]) }),
    ).toBeNull();
  });

  it('takes a trade initiator from the record, not from the money', () => {
    const trade = participants(['a', 0], ['b', 0]);
    expect(
      reversalInitiatorPlayerId({
        type: 'PROPERTY_TRANSFER',
        participants: trade,
        initiatorPlayerId: 'b',
      }),
    ).toBe('b');
    expect(
      reversalInitiatorPlayerId({ type: 'PROPERTY_TRANSFER', participants: trade }),
    ).toBeNull();
    expect(
      reversalInitiatorPlayerId({
        type: 'PROPERTY_TRANSFER',
        participants: participants(['a', -50], ['b', 50]),
        initiatorPlayerId: null,
      }),
    ).toBeNull();
  });

  it('has no initiator when several players paid or several received', () => {
    expect(
      reversalInitiatorPlayerId({
        type: 'PLAYER_TO_ALL',
        participants: participants(['a', -5], ['b', -5]),
      }),
    ).toBeNull();
    expect(
      reversalInitiatorPlayerId({
        type: 'BANK_TO_PLAYER',
        participants: participants(['a', 5], ['b', 5]),
      }),
    ).toBeNull();
  });

  it('has no initiator when nobody paid or nobody received', () => {
    expect(
      reversalInitiatorPlayerId({ type: 'PLAYER_TO_BANK', participants: participants(['a', 0]) }),
    ).toBeNull();
    expect(
      reversalInitiatorPlayerId({ type: 'BANK_TO_PLAYER', participants: participants(['a', 0]) }),
    ).toBeNull();
    expect(reversalInitiatorPlayerId({ type: 'PLAYER_TO_BANK', participants: [] })).toBeNull();
    expect(reversalInitiatorPlayerId({ type: 'BANK_TO_PLAYER', participants: [] })).toBeNull();
  });

  it('does not count a participant with no change as the payer or the receiver', () => {
    expect(
      reversalInitiatorPlayerId({
        type: 'PLAYER_TO_PLAYER',
        participants: participants(['z', 0], ['a', -5], ['b', 5]),
      }),
    ).toBe('a');
    expect(
      reversalInitiatorPlayerId({
        type: 'BANK_TO_PLAYER',
        participants: participants(['z', 0], ['a', 5]),
      }),
    ).toBe('a');
  });
});

describe('findReversalDependency boundaries', () => {
  const stored = (
    id: string,
    type: Transaction['type'],
    deltas: [string, number][],
    extra: Partial<Transaction> = {},
  ): Transaction => ({
    id,
    gameId: 'g',
    type,
    amount: 10,
    totalAmount: 10,
    comment: null,
    createdAt: '',
    participants: participants(...deltas),
    ...extra,
  });

  it('never makes a transaction depend on itself', () => {
    const original = stored('t1', 'MORTGAGE', [['a', 10]], { tileId: 'x' });
    expect(findReversalDependency(original, [original])).toBeNull();
  });

  it('is blocked when any participant of the later operation is a player of the original', () => {
    const original = stored('t1', 'PLAYER_TO_PLAYER', [
      ['a', -10],
      ['b', 10],
    ]);
    const later = stored('t2', 'LOAN_ISSUE', [
      ['c', -10],
      ['b', 10],
    ]);
    expect(findReversalDependency(original, [later])).toBe(later);
  });

  it('is not blocked by a dependent type between players unrelated to the original', () => {
    const original = stored('t1', 'PLAYER_TO_BANK', [['a', -10]]);
    const later = stored('t2', 'LOAN_ISSUE', [
      ['c', -10],
      ['d', 10],
    ]);
    expect(findReversalDependency(original, [later])).toBeNull();
  });

  it('is blocked by a later operation on any tile of the colour group, not only on all of them', () => {
    const original = stored('t1', 'PROPERTY_PURCHASE', [['a', -10]], { tileId: 'g1' });
    const build = stored('t2', 'PROPERTY_BUILD', [['z', -10]], { tileIds: ['g2', 'elsewhere'] });
    expect(findReversalDependency(original, [build], ['g1', 'g2'])).toBe(build);
  });

  it('is not blocked by an operation outside the colour group', () => {
    const original = stored('t1', 'PROPERTY_PURCHASE', [['a', -10]], { tileId: 'g1' });
    const build = stored('t2', 'PROPERTY_BUILD', [['z', -10]], { tileIds: ['elsewhere'] });
    expect(findReversalDependency(original, [build], ['g1', 'g2'])).toBeNull();
    expect(findReversalDependency(original, [build])).toBeNull();
  });

  it('does not let an original type without group blockers be blocked through the group', () => {
    const original = stored('t1', 'PLAYER_TO_BANK', [['a', -10]]);
    const rent = stored('t2', 'PAY_RENT', [['z', -10]], { tileId: 'g2' });
    expect(findReversalDependency(original, [rent], ['g1', 'g2'])).toBeNull();
  });

  it('does not let a group operation of another type block a purchase', () => {
    const original = stored('t1', 'PROPERTY_PURCHASE', [['a', -10]], { tileId: 'g1' });
    const mortgage = stored('t2', 'PLAYER_TO_PLAYER', [['z', -10]], { tileId: 'g2' });
    expect(findReversalDependency(original, [mortgage], ['g1', 'g2'])).toBeNull();
  });

  it('skips a later operation that was itself reversed and returns the first live one', () => {
    const original = stored('t1', 'PLAYER_TO_BANK', [['a', -10]]);
    const reversed = stored('t2', 'LOAN_ISSUE', [['a', 10]], { reversedByTransactionId: 'r' });
    const live = stored('t3', 'LOAN_ISSUE', [['a', 10]]);
    expect(findReversalDependency(original, [reversed, live])).toBe(live);
  });
});

describe('reversalAvailability for a viewer who is not the actor', () => {
  const base = {
    id: 't1',
    gameId: 'g',
    amount: 10,
    totalAmount: 10,
    comment: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const now = Date.parse(base.createdAt) + 1000;

  it('hides a transaction that has no single initiator from a player', () => {
    const shared: Transaction = {
      ...base,
      type: 'BANK_TO_PLAYER',
      participants: participants(['a', 5], ['b', 5]),
    };
    expect(
      reversalAvailability({
        transaction: shared,
        isOwner: false,
        controlledPlayerIds: ['a'],
        now,
      }),
    ).toEqual({ status: 'hidden' });
    expect(
      reversalAvailability({ transaction: shared, isOwner: true, controlledPlayerIds: [], now }),
    ).toEqual({ status: 'allowed' });
  });

  it('hides a transaction the viewer did not make, and one that cannot be reversed, from a player', () => {
    const payment: Transaction = {
      ...base,
      type: 'PLAYER_TO_BANK',
      participants: participants(['a', -10]),
    };
    expect(
      reversalAvailability({
        transaction: payment,
        isOwner: false,
        controlledPlayerIds: ['b'],
        now,
      }),
    ).toEqual({ status: 'hidden' });
    expect(
      reversalAvailability({
        transaction: { ...payment, type: 'REVERSAL' },
        isOwner: true,
        controlledPlayerIds: ['a'],
        now,
      }),
    ).toEqual({ status: 'hidden' });
    expect(
      reversalAvailability({
        transaction: { ...payment, reversedByTransactionId: 'r1' },
        isOwner: true,
        controlledPlayerIds: ['a'],
        now,
      }),
    ).toEqual({ status: 'hidden' });
  });

  it('reports the dependency that blocks an owner and passes the group tiles on', () => {
    const purchase: Transaction = {
      ...base,
      type: 'PROPERTY_PURCHASE',
      tileId: 'g1',
      participants: participants(['a', -10]),
    };
    const rent: Transaction = {
      ...base,
      id: 't2',
      type: 'PAY_RENT',
      tileId: 'g2',
      participants: participants(['z', -5], ['y', 5]),
    };
    expect(
      reversalAvailability({
        transaction: purchase,
        isOwner: true,
        controlledPlayerIds: [],
        now,
        later: [rent],
        groupTileIds: ['g1', 'g2'],
      }),
    ).toEqual({ status: 'blocked', reason: 'LATER_OPERATION', dependency: rent });
    expect(
      reversalAvailability({
        transaction: purchase,
        isOwner: true,
        controlledPlayerIds: [],
        now,
        later: [rent],
      }),
    ).toEqual({ status: 'allowed' });
  });
});
