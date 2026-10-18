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

describe('loan boundaries', () => {
  it('never reports a negative amount outstanding', () => {
    expect(loanOutstanding(loan({ principal: 100, repaidAmount: 100 }))).toBe(0);
    expect(loanOutstanding(loan({ principal: 100, repaidAmount: 130 }))).toBe(0);
    expect(loanOutstanding(loan({ principal: 100, repaidAmount: 99 }))).toBe(1);
  });

  it('lists as the borrower’s only active player loans that still owe something', () => {
    const loans = [
      loan({ id: 'owing' }),
      loan({ id: 'settled', repaidAmount: 100 }),
      loan({ id: 'written-off', state: 'WRITTEN_OFF' }),
      loan({ id: 'repaid', state: 'REPAID' }),
      loan({ id: 'bank', lenderKind: 'BANK', lenderPlayerId: null }),
      loan({ id: 'other', borrowerPlayerId: 'c' }),
    ];
    expect(activeLoansAsBorrower(loans, 'b').map((item) => item.id)).toEqual(['owing']);
  });

  it('counts only active loans in the debt, including the bank’s as owed by the borrower', () => {
    const loans = [
      loan({ id: 'owing', principal: 100, repaidAmount: 40 }),
      loan({ id: 'repaid', state: 'REPAID', principal: 500, repaidAmount: 500 }),
      loan({ id: 'off', state: 'WRITTEN_OFF', principal: 700, repaidAmount: 0 }),
      loan({
        id: 'bank',
        lenderKind: 'BANK',
        lenderPlayerId: null,
        principal: 30,
        repaidAmount: 0,
      }),
    ];
    expect(playerDebt(loans, 'b')).toEqual({ owes: 90, owed: 0 });
    expect(playerDebt(loans, 'a')).toEqual({ owes: 0, owed: 60 });
  });

  it('does not credit the lender of a loan that is no longer the player’s lender kind', () => {
    const bank = loan({ lenderKind: 'BANK', lenderPlayerId: 'a' });
    expect(playerDebt([bank], 'a')).toEqual({ owes: 0, owed: 0 });
  });

  it('finds an active bank loan only while something is owed on it', () => {
    const bank = loan({ id: 'bk', lenderKind: 'BANK', lenderPlayerId: null, repaidAmount: 100 });
    expect(activeBankLoan([bank], 'b')).toBeNull();
    expect(activeBankLoan([{ ...bank, repaidAmount: 99 }], 'b')?.id).toBe('bk');
    expect(activeBankLoan([{ ...bank, repaidAmount: 0, lenderKind: 'PLAYER' }], 'b')).toBeNull();
  });

  it('charges no interest on nothing and rounds the half up otherwise', () => {
    expect(loanInterest(0, 20)).toBe(0);
    expect(loanInterest(-100, 20)).toBe(0);
    expect(loanInterest(5, 10)).toBe(1);
    expect(loanInterest(4, 10)).toBe(0);
    expect(loanInterest(200, 0)).toBe(0);
    expect(loanInterest(1, 20)).toBe(0);
  });
});
