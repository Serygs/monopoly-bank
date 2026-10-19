import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import {
  translate,
  type Language,
  type TranslationKey,
  type TranslationValues,
} from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from './money';

interface DescriptionContext {
  transaction: Transaction;
  negative: Transaction['participants'][number] | undefined;
  positive: Transaction['participants'][number] | undefined;
  language: Language;
  tileName: string | undefined;
  nameOf: (id: string | undefined) => string;
  tr: (key: TranslationKey, values?: TranslationValues) => string;
  withTile: (text: string) => string;
}

type Describe = (context: DescriptionContext) => string;

const trimmedComment = (transaction: Transaction): string | null =>
  transaction.comment === null || transaction.comment.trim() === ''
    ? null
    : transaction.comment.trim();

const transfer: Describe = ({ negative, positive, nameOf }) =>
  `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;

const labelled =
  (side: 'negative' | 'positive', key: TranslationKey): Describe =>
  (context) =>
    context.withTile(`${context.nameOf(context[side]?.playerId)} · ${context.tr(key)}`);

const toCounterparty =
  (side: 'negative', key: TranslationKey): Describe =>
  (context) =>
    `${context.nameOf(context[side]?.playerId)} → ${context.tr(key)}`;

const fromCounterparty =
  (key: TranslationKey): Describe =>
  (context) =>
    `${context.tr(key)} → ${context.nameOf(context.positive?.playerId)}`;

function describeTrade({
  transaction,
  negative,
  nameOf,
  tr,
  withTile,
}: DescriptionContext): string {
  const initiator = transaction.initiatorPlayerId ?? negative?.playerId;
  const other = transaction.participants.find((item) => item.playerId !== initiator);
  return withTile(
    `${nameOf(initiator ?? undefined)} ⇄ ${nameOf(other?.playerId)} · ${tr('propertyTradeLabel')}`,
  );
}

function describeLoanIssue({ negative, positive, nameOf, tr }: DescriptionContext): string {
  if (negative === undefined)
    return tr('loanIssueBankDescription', { borrower: nameOf(positive?.playerId) });
  return tr('loanIssueDescription', {
    lender: nameOf(negative.playerId),
    borrower: nameOf(positive?.playerId),
  });
}

function describeLoanRepayment({ negative, positive, nameOf, tr }: DescriptionContext): string {
  if (positive === undefined)
    return tr('loanRepaymentBankDescription', { borrower: nameOf(negative?.playerId) });
  return tr('loanRepaymentDescription', {
    borrower: nameOf(negative?.playerId),
    lender: nameOf(positive.playerId),
  });
}

function describeJackpotPayment({ transaction, negative, nameOf, tr }: DescriptionContext): string {
  const purpose = trimmedComment(transaction);
  const name = nameOf(negative?.playerId);
  return purpose === null
    ? tr('jackpotPaymentDescription', { name })
    : tr('jackpotPaymentForDescription', { name, purpose });
}

function describeAuctionPayment({
  transaction,
  negative,
  tileName,
  nameOf,
  tr,
}: DescriptionContext): string {
  const name = nameOf(negative?.playerId);
  if (tileName !== undefined) return tr('auctionPaymentDescription', { name, lot: tileName });
  const lot = trimmedComment(transaction);
  return lot === null
    ? tr('auctionPaymentUnnamedDescription', { name })
    : tr('auctionPaymentDescription', { name, lot });
}

function counterpartyLabel(
  participants: Transaction['participants'],
  nameOf: DescriptionContext['nameOf'],
  tr: DescriptionContext['tr'],
): string {
  if (participants.length === 0) return tr('transactionBank');
  if (participants.length > 1) return tr('transactionEveryone');
  return nameOf(participants[0]?.playerId);
}

function describeReversal({ transaction, nameOf, tr }: DescriptionContext): string {
  const debited = transaction.participants.filter((participant) => participant.balanceDelta < 0);
  const credited = transaction.participants.filter((participant) => participant.balanceDelta > 0);
  return `${tr('reversal')} · ${counterpartyLabel(debited, nameOf, tr)} → ${counterpartyLabel(credited, nameOf, tr)}`;
}

const DESCRIBE: Record<Transaction['type'], Describe> = {
  PLAYER_TO_PLAYER: transfer,
  PAY_RENT: (context) => context.withTile(`${transfer(context)} · ${context.tr('rent')}`),
  PROPERTY_PURCHASE: labelled('negative', 'propertyPurchaseLabel'),
  PROPERTY_TRANSFER: describeTrade,
  PROPERTY_BUILD: labelled('negative', 'propertyBuildLabel'),
  PROPERTY_SELL_BUILDING: labelled('positive', 'propertySellBuildingLabel'),
  PLAYER_TO_BANK: toCounterparty('negative', 'transactionBank'),
  BANK_TO_PLAYER: fromCounterparty('transactionBank'),
  PLAYER_TO_ALL: toCounterparty('negative', 'transactionEveryone'),
  ALL_TO_PLAYER: fromCounterparty('transactionEveryone'),
  PASS_GO: ({ positive, nameOf, tr }) => `${nameOf(positive?.playerId)} · ${tr('passedGo')}`,
  MORTGAGE: labelled('positive', 'mortgageLabel'),
  MORTGAGE_REDEMPTION: labelled('negative', 'redemptionLabel'),
  LOAN_ISSUE: describeLoanIssue,
  LOAN_REPAYMENT: describeLoanRepayment,
  TO_JACKPOT: describeJackpotPayment,
  JACKPOT_PAYOUT: ({ positive, nameOf, tr }) =>
    tr('jackpotPayoutDescription', { name: nameOf(positive?.playerId) }),
  AUCTION_PAYMENT: describeAuctionPayment,
  BANKRUPTCY_TRANSFER: ({ negative, positive, nameOf, tr }) =>
    tr('bankruptcyTransactionDescription', {
      source: nameOf(negative?.playerId),
      destination: nameOf(positive?.playerId),
    }),
  REVERSAL: describeReversal,
};

export function transactionDescription(
  transaction: Transaction,
  players: Player[],
  language: Language = 'en',
  /** Board games: the name of the tile the operation concerned, from the game's board snapshot. */
  tileName?: string,
): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const fallback = translate(language, 'playerFallback');
  return DESCRIBE[transaction.type]({
    transaction,
    negative: transaction.participants.find((participant) => participant.balanceDelta < 0),
    positive: transaction.participants.find((participant) => participant.balanceDelta > 0),
    language,
    tileName,
    nameOf: (id) => (id === undefined ? fallback : (names.get(id) ?? fallback)),
    tr: (key, values) => translate(language, key, values),
    withTile: (text) => (tileName === undefined ? text : `${text} · ${tileName}`),
  });
}

export function transactionAmount(
  transaction: Transaction,
  currency: Currency,
  language: Language = 'en',
): string {
  const money = (value: number) => formatMoney(value, currency);
  if (transaction.type === 'PLAYER_TO_ALL' || transaction.type === 'ALL_TO_PLAYER')
    return translate(language, 'eachAmount', {
      amount: money(transaction.amount),
      total: money(transaction.totalAmount),
    });
  if (
    transaction.type === 'PASS_GO' ||
    transaction.type === 'MORTGAGE' ||
    transaction.type === 'PROPERTY_SELL_BUILDING' ||
    transaction.type === 'JACKPOT_PAYOUT'
  )
    return `+${money(transaction.amount)}`;
  if (transaction.type === 'REVERSAL') return money(transaction.totalAmount);
  return money(transaction.amount);
}

export function playerTransactionAmount(
  transaction: Transaction,
  playerId: string,
  currency: Currency,
): string | null {
  const delta = transaction.participants.find(
    (participant) => participant.playerId === playerId,
  )?.balanceDelta;
  if (delta === undefined) return null;
  return formatMoneyDelta(delta, currency);
}
