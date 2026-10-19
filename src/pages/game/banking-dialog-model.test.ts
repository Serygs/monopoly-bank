import { describe, expect, it } from 'vitest';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import {
  amountValueOf,
  buildModeOf,
  completedAmount,
  cooldownRetryRounds,
  effectiveBuildLevels,
  exceedsBankLoanMax,
  exceedsBankToPlayerMax,
  requestActionOf,
  resolveBuildGroup,
} from './banking-dialog-model';
import { chooseLoanPatch, selectActionPatch } from './banking-dialog-fields';

describe('banking dialog model', () => {
  it('resolves the colour group from the pick, the quick entry or the only choice', () => {
    expect(resolveBuildGroup('brown', ['brown', 'blue'], 'blue')).toBe('brown');
    expect(resolveBuildGroup('green', ['brown', 'blue'], 'blue')).toBe('blue');
    expect(resolveBuildGroup('', ['brown'], undefined)).toBe('brown');
    expect(resolveBuildGroup('', ['brown', 'blue'], undefined)).toBe('');
  });

  it('keeps levels untouched only when nothing was set', () => {
    expect(effectiveBuildLevels('', { a: 1 }, 'brown', { a: 2 })).toEqual({});
    expect(effectiveBuildLevels('brown', null, 'brown', { a: 2 })).toEqual({ a: 2 });
    expect(effectiveBuildLevels('brown', null, 'blue', { a: 2 })).toEqual({});
    expect(effectiveBuildLevels('brown', { a: 1 }, 'brown', { a: 2 })).toEqual({ a: 1 });
  });

  it('maps build actions to modes', () => {
    expect(buildModeOf('PROPERTY_BUILD')).toBe('BUILD');
    expect(buildModeOf('PROPERTY_SELL_BUILDING')).toBe('SELL');
    expect(buildModeOf('PAY_RENT')).toBeNull();
  });

  it('takes the whole pot for a collection and the tile amount for a tile action', () => {
    expect(amountValueOf('JACKPOT_PAYOUT', 90, false, 0, '5')).toBe(90);
    expect(amountValueOf('PROPERTY_PURCHASE', 90, true, 300, '5')).toBe(300);
    expect(amountValueOf('PLAYER_TO_BANK', 90, false, 300, '5')).toBe(5);
  });

  it('pays the pot only for a tax chip when the rule is on', () => {
    expect(requestActionOf('PLAYER_TO_BANK', true, true)).toBe('TO_JACKPOT');
    expect(requestActionOf('PLAYER_TO_BANK', true, false)).toBe('PLAYER_TO_BANK');
    expect(requestActionOf('PLAYER_TO_BANK', false, true)).toBe('PLAYER_TO_BANK');
  });

  it('caps a bank payment at 4 000 000 and a bank loan at its maximum', () => {
    expect(exceedsBankToPlayerMax('BANK_TO_PLAYER', 4_000_000)).toBe(false);
    expect(exceedsBankToPlayerMax('BANK_TO_PLAYER', 4_000_001)).toBe(true);
    expect(exceedsBankToPlayerMax('PLAYER_TO_BANK', 4_000_001)).toBe(false);
    expect(exceedsBankLoanMax('BANK_LOAN', 11, 10)).toBe(true);
    expect(exceedsBankLoanMax('BANK_LOAN', 10, 10)).toBe(false);
    expect(exceedsBankLoanMax('BANK_LOAN', 11, null)).toBe(false);
  });

  it('reads the rounds left from a cooldown error and ignores other errors', () => {
    const apiError = (code: string, details?: Record<string, unknown>) =>
      new MonopolyBankApiError({
        code,
        message: 'x',
        ...(details === undefined ? {} : { details }),
      });
    const cooldown = (details?: Record<string, unknown>) => apiError('BANK_LOAN_COOLDOWN', details);
    expect(cooldownRetryRounds(cooldown({ roundsLeft: 2 }))).toBe(2);
    expect(cooldownRetryRounds(cooldown())).toBe(1);
    expect(cooldownRetryRounds(apiError('OTHER'))).toBeNull();
    expect(cooldownRetryRounds(new Error('x'))).toBeNull();
  });

  it('hides the amount after actions that have none to report', () => {
    expect(completedAmount('PASS_GO', 200)).toBeNull();
    expect(completedAmount('MORTGAGE', 200)).toBeNull();
    expect(completedAmount('PAY_RENT', 200)).toBeNull();
    expect(completedAmount('PLAYER_TO_BANK', 200)).toBe(200);
  });

  it('opens Pass GO and the pot collection on the confirmation', () => {
    expect(selectActionPatch('PASS_GO', true, 'double').confirming).toBe(true);
    expect(selectActionPatch('JACKPOT_PAYOUT', false, 'double').confirming).toBe(true);
    expect(selectActionPatch('PLAYER_TO_BANK', false, 'double').confirming).toBe(false);
    expect(selectActionPatch('PASS_GO', true, 'double').comment).toBe('double');
    expect(selectActionPatch('PASS_GO', false, 'double').comment).toBe('');
  });

  it('proposes repaying the whole loan', () => {
    const loan = { id: 'l1', principal: 100, repaidAmount: 30 } as Parameters<
      typeof chooseLoanPatch
    >[0];
    expect(chooseLoanPatch(loan)).toEqual({
      loanId: 'l1',
      ratePercent: null,
      amount: '70',
      payToPot: false,
    });
  });
});
