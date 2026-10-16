import { describe, expect, it } from 'vitest';
import type { Loan } from '../../shared/types/monopoly';
import { activeLoansAsBorrower, loanOutstanding, playerDebt } from './loans';

const loan = (overrides: Partial<Loan>): Loan => ({
  id: 'l1',
  gameId: 'g',
  lenderKind: 'PLAYER',
  lenderPlayerId: 'a',
  borrowerPlayerId: 'b',
  principal: 100,
  repaidAmount: 30,
  state: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  ...overrides,
});

describe('loans', () => {
  it('computes outstanding and per-player debt', () => {
    expect(loanOutstanding(loan({}))).toBe(70);
    const loans = [loan({}), loan({ id: 'l2', principal: 50, repaidAmount: 0 })];
    expect(playerDebt(loans, 'b')).toEqual({ owes: 120, owed: 0 });
    expect(playerDebt(loans, 'a')).toEqual({ owes: 0, owed: 120 });
    expect(playerDebt(loans, 'c')).toEqual({ owes: 0, owed: 0 });
  });

  it('lists only active loans of the borrower', () => {
    const loans = [loan({}), loan({ id: 'l2', state: 'REPAID', repaidAmount: 100 })];
    expect(activeLoansAsBorrower(loans, 'b').map((item) => item.id)).toEqual(['l1']);
    expect(activeLoansAsBorrower(loans, 'a')).toEqual([]);
  });
});
