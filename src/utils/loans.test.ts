import { describe, expect, it } from 'vitest';
import type { Loan } from '../../shared/types/monopoly';
import {
  activeBankLoan,
  activeLoansAsBorrower,
  loanInterest,
  loanOutstanding,
  playerDebt,
} from './loans';

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

describe('bank loans', () => {
  const bank = loan({ id: 'b1', lenderKind: 'BANK', lenderPlayerId: null, repaidAmount: 0 });

  it('finds the active bank loan of a borrower only', () => {
    expect(activeBankLoan([loan({}), bank], 'b')?.id).toBe('b1');
    expect(activeBankLoan([bank], 'a')).toBeNull();
    expect(activeBankLoan([{ ...bank, state: 'REPAID' }], 'b')).toBeNull();
  });

  it('counts a bank loan as a debt but never as money owed to a player', () => {
    expect(playerDebt([bank], 'b')).toEqual({ owes: 100, owed: 0 });
  });

  it('rounds the interest half up like the Worker', () => {
    expect(loanInterest(400, 10)).toBe(40);
    expect(loanInterest(400, 0)).toBe(0);
    expect(loanInterest(105, 10)).toBe(11);
    expect(loanInterest(104, 10)).toBe(10);
    expect(loanInterest(25, 20)).toBe(5);
    expect(loanInterest(13, 10)).toBe(1);
  });
});
