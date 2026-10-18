import type { PropertyGroupId } from '../../../shared/board';
import { redemptionCost } from '../../../shared/domain/mortgage';
import type { InterestRatePercent, Loan, Mortgage } from '../../../shared/types/monopoly';
import { activeBankLoan, loanOutstanding } from '../../utils/loans';
import { reviewOnlyActions } from './banking-actions';
import type { BankingDialogProps } from './banking-dialog-types';
import type { ActionType } from './game-page-helpers';

export type BankingInputs = Required<
  Pick<
    BankingDialogProps,
    | 'player'
    | 'players'
    | 'passGoReward'
    | 'currency'
    | 'rules'
    | 'settings'
    | 'mortgages'
    | 'properties'
    | 'loans'
    | 'bankLoanCooldowns'
    | 'jackpot'
    | 'auction'
    | 'settleOnOpen'
  >
> &
  Pick<BankingDialogProps, 'startingBalance' | 'initialAction' | 'initialTileId'>;

export interface BankingFields {
  action: ActionType | null;
  tileId: string;
  diceSum: string;
  exactGoChosen: boolean;
  targetId: string;
  amount: string;
  comment: string;
  commentOpen: boolean;
  confirming: boolean;
  exactLanding: boolean;
  payToPot: boolean;
  propertyName: string;
  noBuildings: boolean;
  overrideOn: boolean;
  overridePrice: string;
  overrideConfirmed: boolean;
  buildGroup: PropertyGroupId | '';
  buildLevels: Record<string, number> | null;
  mortgageId: string;
  loanId: string;
  ratePercent: InterestRatePercent | null;
  cooldownRounds: number | null;
  cooldownAcknowledged: boolean;
}

const clearedFields: Omit<BankingFields, 'action' | 'exactGoChosen'> = {
  tileId: '',
  diceSum: '',
  targetId: '',
  amount: '',
  comment: '',
  commentOpen: false,
  confirming: false,
  exactLanding: false,
  payToPot: false,
  propertyName: '',
  noBuildings: false,
  overrideOn: false,
  overridePrice: '',
  overrideConfirmed: false,
  buildGroup: '',
  buildLevels: null,
  mortgageId: '',
  loanId: '',
  ratePercent: null,
  cooldownRounds: null,
  cooldownAcknowledged: false,
};

function settledBankLoan(inputs: BankingInputs): Loan | null {
  return inputs.rules.bankLoans && inputs.settleOnOpen
    ? activeBankLoan(inputs.loans, inputs.player.id)
    : null;
}

function quickRedemption(inputs: BankingInputs): Mortgage | undefined {
  const quickEntry =
    inputs.settings?.board != null &&
    inputs.initialAction === 'MORTGAGE_REDEMPTION' &&
    inputs.initialTileId !== undefined;
  return quickEntry
    ? inputs.mortgages.find(
        (item) => item.playerId === inputs.player.id && item.tileId === inputs.initialTileId,
      )
    : undefined;
}

function openingAction(inputs: BankingInputs, bankLoan: Loan | null): ActionType | null {
  if (bankLoan !== null) return 'LOAN_REPAYMENT';
  return inputs.settings?.board == null ? null : (inputs.initialAction ?? null);
}

function openingAmount(bankLoan: Loan | null, redemption: Mortgage | undefined): string {
  if (bankLoan !== null) return String(loanOutstanding(bankLoan));
  return redemption === undefined ? '' : String(redemptionCost(redemption.mortgageValue));
}

export function initialFields(inputs: BankingInputs): BankingFields {
  const bankLoan = settledBankLoan(inputs);
  const redemption = quickRedemption(inputs);
  return {
    ...clearedFields,
    action: openingAction(inputs, bankLoan),
    exactGoChosen: false,
    tileId: inputs.initialAction === 'MORTGAGE_REDEMPTION' ? '' : (inputs.initialTileId ?? ''),
    amount: openingAmount(bankLoan, redemption),
    mortgageId: redemption?.id ?? '',
    loanId: bankLoan?.id ?? '',
  };
}

export function selectActionPatch(
  next: ActionType | null,
  exact: boolean,
  exactComment: string,
): Partial<BankingFields> {
  return {
    ...clearedFields,
    action: next,
    exactLanding: exact,
    comment: exact ? exactComment : '',
    confirming: next !== null && reviewOnlyActions.has(next),
  };
}

export function chooseLoanPatch(loan: Loan): Partial<BankingFields> {
  return {
    loanId: loan.id,
    ratePercent: null,
    amount: String(loanOutstanding(loan)),
    payToPot: false,
  };
}

export function chooseMortgagePatch(mortgage: Mortgage): Partial<BankingFields> {
  return {
    mortgageId: mortgage.id,
    amount: String(redemptionCost(mortgage.mortgageValue)),
    payToPot: false,
  };
}
