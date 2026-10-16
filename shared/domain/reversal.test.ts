import { describe, expect, it } from 'vitest';
import {
  canReverseTransaction,
  isReversibleType,
  isWithinReversalWindow,
  REVERSAL_WINDOW_MS,
  reversalInitiatorPlayerId,
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

  it('offers a player only their own transactions, and only within the window', () => {
    const own = { isOwner: false, controlledPlayerIds: ['a'], transaction: base };
    expect(canReverseTransaction({ ...own, now: start + 1000 })).toBe(true);
    expect(canReverseTransaction({ ...own, now: start + REVERSAL_WINDOW_MS + 1 })).toBe(false);
    expect(canReverseTransaction({ ...own, controlledPlayerIds: ['b'], now: start + 1000 })).toBe(
      false,
    );
  });
});
