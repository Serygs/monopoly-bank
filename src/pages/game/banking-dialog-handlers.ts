import type { PropertyGroupId } from '../../../shared/board';
import type { InterestRatePercent, Loan, Mortgage } from '../../../shared/types/monopoly';
import type { Translate } from '../../i18n/translations';
import type { TileView } from '../../utils/property-view';
import type { BankingDerived } from './banking-dialog-derive';
import {
  chooseLoanPatch,
  chooseMortgagePatch,
  selectActionPatch,
  type BankingFields,
  type BankingInputs,
} from './banking-dialog-fields';
import { preflightFundsError, type ActionType } from './game-page-helpers';

type Edit = (changes: Partial<BankingFields>) => void;

export function fieldHandlers(edit: Edit) {
  return {
    changeAmount: (amount: string) => edit({ amount, payToPot: false }),
    changeTarget: (targetId: string) => edit({ targetId }),
    changeComment: (comment: string) => edit({ comment }),
    changePropertyName: (propertyName: string) => edit({ propertyName }),
    changeOverrideOn: (overrideOn: boolean) => edit({ overrideOn, overrideConfirmed: false }),
    changeOverridePrice: (overridePrice: string) =>
      edit({ overridePrice, overrideConfirmed: false }),
    chooseTile: (view: TileView) =>
      edit({ tileId: view.tile.id, overrideConfirmed: false, diceSum: '' }),
    changeBuildGroup: (buildGroup: PropertyGroupId) => edit({ buildGroup, buildLevels: {} }),
    changeBuildLevels: (buildLevels: Record<string, number>) => edit({ buildLevels }),
    changeDiceSum: (next: string) => edit({ diceSum: next.replace(/\D/g, '').slice(0, 2) }),
    chooseMortgage: (mortgage: Mortgage) => edit(chooseMortgagePatch(mortgage)),
    chooseLoan: (loan: Loan) => edit(chooseLoanPatch(loan)),
    chooseRate: (ratePercent: InterestRatePercent) => edit({ ratePercent }),
  };
}

export interface FlowContext {
  inputs: BankingInputs;
  fields: BankingFields;
  d: BankingDerived;
  t: Translate;
  available: number;
  edit: Edit;
  patch: Edit;
}

function quickHandlers(ctx: FlowContext) {
  const { inputs, fields, d, t, available, edit, patch } = ctx;

  const reviewFixedPayment = (label: string, fixedAmount: number, toPot: boolean) =>
    edit({
      amount: String(fixedAmount),
      payToPot: toPot,
      comment: label,
      ...(available >= fixedAmount ? { confirming: true } : {}),
    });

  const reviewQuickAmount = (nextAmount: number) => {
    edit({ amount: String(nextAmount), payToPot: false });
    const { player, players, currency } = inputs;
    const affordable =
      preflightFundsError(fields.action, player, players, nextAmount, currency, t) === null;
    if (fields.action === 'PLAYER_TO_PLAYER' && d.target !== null && affordable)
      patch({ confirming: true });
  };

  return { reviewFixedPayment, reviewQuickAmount };
}

export function flowHandlers(ctx: FlowContext) {
  const { fields, d, t, edit, patch } = ctx;

  const select = (next: ActionType | null, exact = false) =>
    edit(selectActionPatch(next, exact, t('passGoExactComment')));

  const review = () => {
    const { cooldown } = d.loan;
    if (fields.action === 'BANK_LOAN' && cooldown !== null && !fields.cooldownAcknowledged)
      patch({ cooldownRounds: cooldown.roundsLeft });
    else patch({ confirming: true });
  };

  const borrowAnyway = () =>
    edit({ cooldownAcknowledged: true, cooldownRounds: null, confirming: true });

  const settleBankLoan = (loan: Loan) =>
    edit({
      ...selectActionPatch('LOAN_REPAYMENT', false, t('passGoExactComment')),
      ...chooseLoanPatch(loan),
    });

  return { select, review, borrowAnyway, settleBankLoan, ...quickHandlers(ctx) };
}
