import type {
  WalletMenuGroup,
  WalletMenuItem,
  WalletMenuTone,
} from '../../components/game/WalletMenu';
import {
  actionLabel,
  advancedWalletActions,
  primaryWalletActions,
  walletActionTone,
  type ActionType,
} from './game-page-helpers';
import type { BankingForm } from './useBankingDialog';

interface Entry {
  key: ActionType;
  show: boolean;
}

/** Red when the action takes money out of the wallet, green when it brings money in. */
const toneOf = (key: ActionType): WalletMenuTone => walletActionTone(key);

function actionItems(form: BankingForm, entries: readonly Entry[]): WalletMenuItem[] {
  return entries
    .filter((entry) => entry.show)
    .map(({ key }) => ({
      key,
      label: actionLabel(key, form.t),
      tone: toneOf(key),
      onSelect: () => form.handlers.select(key),
    }));
}

export function primaryItems(form: BankingForm): WalletMenuItem[] {
  const hasBoard = form.d.board !== null;
  const actions = hasBoard
    ? [...primaryWalletActions.slice(0, 1), 'PAY_RENT' as const, ...primaryWalletActions.slice(1)]
    : primaryWalletActions;
  const exactGo = form.fields.exactGoChosen;
  return actions.map((key) => ({
    key,
    label: actionLabel(key, form.t),
    tone: toneOf(key),
    onSelect: () => form.handlers.select(key, key === 'PASS_GO' && exactGo),
  }));
}

function propertyItems(form: BankingForm): WalletMenuItem[] {
  const { d, items, props, t, auctionBusy, canAuction } = form;
  const hasBoard = d.board !== null;
  const mortgageCount = hasBoard ? items.redeem.length : d.mortgage.playerMortgages.length;
  const extra: WalletMenuItem[] = [];
  if (hasBoard && props.onStartTrade !== undefined)
    extra.push({
      key: 'PROPERTY_TRANSFER',
      label: actionLabel('PROPERTY_TRANSFER', t),
      onSelect: props.onStartTrade,
    });
  const onStartAuction = props.onStartAuction;
  if (canAuction && onStartAuction !== undefined)
    extra.push({
      key: 'AUCTION',
      label: t('auctionPutUp'),
      disabled: auctionBusy,
      onSelect: () => onStartAuction(''),
    });
  return [
    ...actionItems(form, [
      { key: 'PROPERTY_PURCHASE', show: hasBoard && items.buy.length > 0 },
      { key: 'PROPERTY_BUILD', show: items.canBuildAny },
      { key: 'PROPERTY_SELL_BUILDING', show: items.canSellAny },
      { key: 'MORTGAGE', show: !hasBoard || items.mortgage.length > 0 },
      { key: 'MORTGAGE_REDEMPTION', show: mortgageCount > 0 },
    ]),
    ...extra,
  ];
}

function loanItems(form: BankingForm): WalletMenuItem[] {
  const { rules } = form.inputs;
  return actionItems(form, [
    { key: 'LOAN_ISSUE', show: rules.playerLoans },
    { key: 'BANK_LOAN', show: rules.bankLoans },
    { key: 'LOAN_REPAYMENT', show: form.d.loan.repayable.length > 0 },
  ]);
}

function groupItems(form: BankingForm): WalletMenuItem[] {
  return advancedWalletActions
    .filter((key) => key === 'PLAYER_TO_ALL' || key === 'ALL_TO_PLAYER')
    .map((key) => ({
      key,
      label: actionLabel(key, form.t),
      tone: toneOf(key),
      onSelect: () => form.handlers.select(key),
    }));
}

export function walletMenuGroups(form: BankingForm): WalletMenuGroup[] {
  const { t, inputs } = form;
  const potFilled = inputs.rules.freeParkingJackpot && inputs.jackpot > 0;
  return [
    {
      key: 'property',
      label: t('walletGroupProperty'),
      icon: 'property',
      items: propertyItems(form),
    },
    { key: 'loans', label: t('walletGroupLoans'), icon: 'loans', items: loanItems(form) },
    { key: 'group', label: t('walletGroupGroup'), icon: 'group', items: groupItems(form) },
    {
      key: 'fund',
      label: t('walletGroupFund'),
      icon: 'fund',
      items: actionItems(form, [{ key: 'JACKPOT_PAYOUT', show: potFilled }]),
    },
  ];
}
