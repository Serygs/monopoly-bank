import type { PropertyGroupId } from '../../../shared/board';
import type { InterestRatePercent, Loan, Mortgage } from '../../../shared/types/monopoly';
import type { Translate } from '../../i18n/translations';
import { groupStreets, type TileView } from '../../utils/property-view';
import type { BankingDerived } from './banking-dialog-derive';
import {
  chooseLoanPatch,
  chooseMortgagePatch,
  mortgageTilesPatch,
  redemptionsPatch,
  selectActionPatch,
  toggledIds,
  type BankingFields,
  type BankingInputs,
} from './banking-dialog-fields';
import { preflightShortfall, type ActionType } from './game-page-helpers';

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
  /** How much the current payment is short by, if it is. */
  shortfall: number | null;
  edit: Edit;
  patch: Edit;
  setError: (error: unknown) => void;
}

function quickHandlers(ctx: FlowContext) {
  const { inputs, fields, d, available, edit } = ctx;

  // Picking a sum the wallet cannot cover goes straight to the "Find funds" menu.
  const reviewFixedPayment = (label: string, fixedAmount: number, toPot: boolean) =>
    edit({
      amount: String(fixedAmount),
      payToPot: toPot,
      comment: label,
      ...(available >= fixedAmount ? { confirming: true } : { raising: true }),
    });

  const reviewQuickAmount = (nextAmount: number) => {
    const spender = { ...inputs.player, balance: available };
    const short = preflightShortfall(fields.action, spender, inputs.players, nextAmount) !== null;
    edit({
      amount: String(nextAmount),
      payToPot: false,
      raising: short,
      confirming: !short && fields.action === 'PLAYER_TO_PLAYER' && d.target !== null,
    });
  };

  return { reviewFixedPayment, reviewQuickAmount };
}

function raiseHandlers(ctx: FlowContext) {
  const { fields, d, t, shortfall, edit, patch, setError } = ctx;
  const { raisePlan } = fields;

  const changePlan = (changes: Partial<typeof raisePlan>) => {
    setError(null);
    patch({ raisePlan: { ...raisePlan, ...changes } });
  };

  const changeRaiseLevels = (group: PropertyGroupId, levels: Record<string, number>) => {
    const streets = new Set(groupStreets(d.views, group).map((view) => view.tile.id));
    const others = Object.entries(raisePlan.levels).filter(([id]) => !streets.has(id));
    changePlan({ levels: { ...Object.fromEntries(others), ...levels } });
  };

  /** Opens an existing form from the menu; the payment and the selection wait behind it. */
  const startRaise = (next: ActionType) =>
    edit({
      ...selectActionPatch(next, false, t('passGoExactComment')),
      resume: fields,
      amount:
        next === 'BANK_LOAN' && shortfall !== null
          ? String(Math.min(shortfall, d.loan.bankLoanMax ?? shortfall))
          : '',
    });

  return {
    openRaise: () => patch({ raising: true }),
    closeRaise: () => {
      setError(null);
      patch({ raising: false, raiseConfirming: false });
    },
    changeRaiseLevels,
    toggleRaiseMortgage: (view: TileView) =>
      changePlan({ mortgageIds: toggledIds(raisePlan.mortgageIds, view.tile.id) }),
    reviewRaise: () => patch({ raiseConfirming: true }),
    backFromRaiseReview: () => {
      setError(null);
      patch({ raiseConfirming: false });
    },
    startRaise,
  };
}

export function flowHandlers(ctx: FlowContext) {
  const { fields, d, t, edit, patch } = ctx;

  const select = (next: ActionType | null, exact = false) =>
    edit(selectActionPatch(next, exact, t('passGoExactComment')));

  /** Back from a form: to the menu it was opened from, or to the wallet's actions. */
  const leaveForm = () => (fields.resume === null ? select(null) : edit(fields.resume));

  const review = () => {
    const { cooldown } = d.loan;
    if (fields.action === 'BANK_LOAN' && cooldown !== null && !fields.cooldownAcknowledged)
      patch({ cooldownRounds: cooldown.roundsLeft });
    else patch({ confirming: true });
  };

  /** Board games: adds a tile to the mortgage batch, or takes it out. */
  const toggleMortgageTile = (view: TileView) =>
    edit(mortgageTilesPatch(toggledIds(fields.batchIds, view.tile.id)));

  /** Board games: adds a mortgage to the redemption batch, or takes it out. */
  const toggleRedemption = (mortgage: Mortgage) => {
    const ids = toggledIds(fields.batchIds, mortgage.id);
    const byId = new Map(d.mortgage.playerMortgages.map((item) => [item.id, item]));
    edit(redemptionsPatch(ids.flatMap((id) => byId.get(id) ?? [])));
  };

  const borrowAnyway = () =>
    edit({ cooldownAcknowledged: true, cooldownRounds: null, confirming: true });

  const settleBankLoan = (loan: Loan) =>
    edit({
      ...selectActionPatch('LOAN_REPAYMENT', false, t('passGoExactComment')),
      ...chooseLoanPatch(loan),
    });

  return {
    select,
    leaveForm,
    review,
    borrowAnyway,
    settleBankLoan,
    toggleMortgageTile,
    toggleRedemption,
    ...quickHandlers(ctx),
    ...raiseHandlers(ctx),
  };
}
