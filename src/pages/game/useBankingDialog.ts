import { defaultGameRules } from '../../../shared/types/monopoly';
import { useBuildingLabel } from '../../components/game/property-labels';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { auctionReserveFor } from '../../utils/auction';
import { formatMoney } from '../../utils/money';
import { presetAmounts } from '../../utils/quick-amounts';
import {
  deriveBanking,
  previewFor,
  requestsFor,
  type BankingDerived,
} from './banking-dialog-derive';
import {
  mortgageTilesPatch,
  redemptionsPatch,
  type BankingFields,
  type BankingInputs,
} from './banking-dialog-fields';
import { fieldHandlers, flowHandlers } from './banking-dialog-handlers';
import type { BankingDialogProps } from './banking-dialog-types';
import { isFormValid } from './banking-dialog-validity';
import { confirmedPropertyName, tileItems } from './banking-tile-items';
import {
  actionLabel,
  insufficientMessage,
  preflightFundsError,
  preflightShortfall,
  type ActionType,
} from './game-page-helpers';
import { useBankingState } from './useBankingState';
import { useBankingSubmit } from './useBankingSubmit';

function resolveInputs(props: BankingDialogProps): BankingInputs {
  return {
    player: props.player,
    players: props.players,
    passGoReward: props.passGoReward,
    currency: props.currency,
    startingBalance: props.startingBalance,
    rules: props.rules ?? defaultGameRules,
    settings: props.settings ?? null,
    mortgages: props.mortgages ?? [],
    properties: props.properties ?? [],
    loans: props.loans ?? [],
    bankLoanCooldowns: props.bankLoanCooldowns ?? [],
    jackpot: props.jackpot ?? 0,
    auction: props.auction ?? null,
    settleOnOpen: props.settleOnOpen ?? false,
    initialAction: props.initialAction,
    initialTileId: props.initialTileId,
  };
}

function useFunds(inputs: BankingInputs, amount: number, action: ActionType | null) {
  const { t } = useLanguage();
  const { player, players, currency } = inputs;
  const reserved = auctionReserveFor(inputs.auction, player.id);
  const available = player.balance - reserved;
  const spender = reserved === 0 ? player : { ...player, balance: available };
  return {
    reserved,
    available,
    error: preflightFundsError(action, spender, players, amount, currency, t),
    shortfall: preflightShortfall(action, spender, players, amount),
  };
}

function useBankingTexts(
  inputs: BankingInputs,
  d: BankingDerived,
  action: ActionType | null,
  error: unknown,
) {
  const { t } = useLanguage();
  const buildingLabel = useBuildingLabel();
  const money = (value: number) => formatMoney(value, inputs.currency);
  const title =
    d.requestAction === null
      ? t('walletTitle', { name: inputs.player.name })
      : actionLabel(d.requestAction, t);
  const transactionError =
    error === null
      ? null
      : (insufficientMessage(error, inputs.players, inputs.currency, t) ??
        apiErrorMessage(error, t, 'unableRecordTransaction'));
  return {
    t,
    money,
    title,
    transactionError,
    items: tileItems(inputs, d, t, money),
    confirmedName: confirmedPropertyName(d, action, t, buildingLabel),
  };
}

function quickPresets(inputs: BankingInputs): number[] | undefined {
  const presets = inputs.startingBalance === undefined ? [] : presetAmounts(inputs.startingBalance);
  return presets.length > 0 ? presets : undefined;
}

export function useBankingDialog(props: BankingDialogProps) {
  const inputs = resolveInputs(props);
  const state = useBankingState(inputs);
  const { fields } = state;
  const d = deriveBanking(inputs, fields);
  const requests = requestsFor(inputs, fields, d);
  const request = requests[0] ?? null;
  const funds = useFunds(inputs, d.amountValue + d.loan.interest, fields.action);
  const valid =
    isFormValid(inputs, fields, d, request) &&
    requests.every((item) => item !== null) &&
    funds.error === null;
  const texts = useBankingTexts(inputs, d, fields.action, state.error);
  const handlers = {
    patchField: state.patch,
    ...fieldHandlers(state.edit),
    ...flowHandlers({ inputs, d, t: texts.t, available: funds.available, ...state }),
  };
  const submit = useBankingSubmit({
    props,
    state,
    action: fields.action,
    requests,
    valid,
    targetName: d.target?.name,
    batchPatch: (ids: string[]): Partial<BankingFields> =>
      fields.action === 'MORTGAGE'
        ? mortgageTilesPatch(ids)
        : redemptionsPatch(d.mortgage.playerMortgages.filter((item) => ids.includes(item.id))),
  });
  return {
    ...texts,
    props,
    inputs,
    fields,
    d,
    funds,
    valid,
    handlers,
    submit,
    request,
    batchSize: requests.length,
    preview: previewFor(inputs, d, request),
    presets: quickPresets(inputs),
    auctionBusy: inputs.auction?.state === 'ACTIVE',
    canAuction: inputs.rules.auctions && props.onStartAuction !== undefined,
    submitting: state.submitting,
  };
}

export type BankingForm = ReturnType<typeof useBankingDialog>;
