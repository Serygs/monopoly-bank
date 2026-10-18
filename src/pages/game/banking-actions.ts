import type { ActionType } from './game-page-helpers';

const actionSet = (...actions: ActionType[]): ReadonlySet<ActionType> => new Set(actions);

export const tileActions = actionSet(
  'PROPERTY_PURCHASE',
  'MORTGAGE',
  'PAY_RENT',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
);

export const buildActions = actionSet('PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING');

export const targetActions = actionSet('PLAYER_TO_PLAYER', 'LOAN_ISSUE');

export const reviewOnlyActions = actionSet('PASS_GO', 'JACKPOT_PAYOUT');

export const mortgageActions = actionSet('MORTGAGE', 'MORTGAGE_REDEMPTION');

export const loanActions = actionSet('LOAN_ISSUE', 'LOAN_REPAYMENT', 'BANK_LOAN');

export const commentlessActions = actionSet(
  ...mortgageActions,
  ...loanActions,
  'PROPERTY_PURCHASE',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
  'PAY_RENT',
);

export const amountlessResultActions = actionSet(
  ...reviewOnlyActions,
  ...mortgageActions,
  'PROPERTY_PURCHASE',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
  'PAY_RENT',
);

export function isIn(set: ReadonlySet<ActionType>, action: ActionType | null): boolean {
  return action !== null && set.has(action);
}
