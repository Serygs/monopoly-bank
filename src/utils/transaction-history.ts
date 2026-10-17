import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import { translate, type Language } from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from './money';

export function transactionDescription(
  transaction: Transaction,
  players: Player[],
  language: Language = 'en',
  /** Board games: the name of the tile the operation concerned, from the game's board snapshot. */
  tileName?: string,
): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const negative = transaction.participants.find((participant) => participant.balanceDelta < 0);
  const positive = transaction.participants.find((participant) => participant.balanceDelta > 0);
  const player = translate(language, 'playerFallback');
  const nameOf = (id: string | undefined) =>
    id === undefined ? player : (names.get(id) ?? player);
  const withTile = (text: string) => (tileName === undefined ? text : `${text} · ${tileName}`);
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER':
      return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;
    case 'PAY_RENT':
      return withTile(
        `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · ${translate(language, 'rent')}`,
      );
    case 'PROPERTY_PURCHASE':
      return withTile(
        `${nameOf(negative?.playerId)} · ${translate(language, 'propertyPurchaseLabel')}`,
      );
    case 'PROPERTY_BUILD':
      return withTile(
        `${nameOf(negative?.playerId)} · ${translate(language, 'propertyBuildLabel')}`,
      );
    case 'PROPERTY_SELL_BUILDING':
      return withTile(
        `${nameOf(positive?.playerId)} · ${translate(language, 'propertySellBuildingLabel')}`,
      );
    case 'PLAYER_TO_BANK':
      return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')}`;
    case 'BANK_TO_PLAYER':
      return `${translate(language, 'transactionBank')} → ${nameOf(positive?.playerId)}`;
    case 'PLAYER_TO_ALL':
      return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionEveryone')}`;
    case 'ALL_TO_PLAYER':
      return `${translate(language, 'transactionEveryone')} → ${nameOf(positive?.playerId)}`;
    case 'PASS_GO':
      return `${nameOf(positive?.playerId)} · ${translate(language, 'passedGo')}`;
    case 'MORTGAGE':
      return withTile(`${nameOf(positive?.playerId)} · ${translate(language, 'mortgageLabel')}`);
    case 'MORTGAGE_REDEMPTION':
      return withTile(`${nameOf(negative?.playerId)} · ${translate(language, 'redemptionLabel')}`);
    case 'LOAN_ISSUE':
      // A bank loan has no lender participant: the money comes from the bank.
      if (negative === undefined)
        return translate(language, 'loanIssueBankDescription', {
          borrower: nameOf(positive?.playerId),
        });
      return translate(language, 'loanIssueDescription', {
        lender: nameOf(negative?.playerId),
        borrower: nameOf(positive?.playerId),
      });
    case 'LOAN_REPAYMENT':
      // A bank loan repayment has no player on the receiving side; the interest is not stored.
      if (positive === undefined)
        return translate(language, 'loanRepaymentBankDescription', {
          borrower: nameOf(negative?.playerId),
        });
      return translate(language, 'loanRepaymentDescription', {
        borrower: nameOf(negative?.playerId),
        lender: nameOf(positive?.playerId),
      });
    case 'TO_JACKPOT':
      // The comment names what was paid (e.g. "Income tax"); without one the payment is unnamed.
      return transaction.comment === null || transaction.comment.trim() === ''
        ? translate(language, 'jackpotPaymentDescription', { name: nameOf(negative?.playerId) })
        : translate(language, 'jackpotPaymentForDescription', {
            name: nameOf(negative?.playerId),
            purpose: transaction.comment.trim(),
          });
    case 'JACKPOT_PAYOUT':
      return translate(language, 'jackpotPayoutDescription', {
        name: nameOf(positive?.playerId),
      });
    case 'AUCTION_PAYMENT':
      // The comment is the lot name.
      if (tileName !== undefined)
        return translate(language, 'auctionPaymentDescription', {
          name: nameOf(negative?.playerId),
          lot: tileName,
        });
      return transaction.comment === null || transaction.comment.trim() === ''
        ? translate(language, 'auctionPaymentUnnamedDescription', {
            name: nameOf(negative?.playerId),
          })
        : translate(language, 'auctionPaymentDescription', {
            name: nameOf(negative?.playerId),
            lot: transaction.comment.trim(),
          });
    case 'BANKRUPTCY_TRANSFER':
      return translate(language, 'bankruptcyTransactionDescription', {
        source: nameOf(negative?.playerId),
        destination: nameOf(positive?.playerId),
      });
    case 'REVERSAL': {
      // Who pays whom in the correction; several payers or payees read as "everyone".
      const debited = transaction.participants.filter(
        (participant) => participant.balanceDelta < 0,
      );
      const credited = transaction.participants.filter(
        (participant) => participant.balanceDelta > 0,
      );
      const from =
        debited.length === 0
          ? translate(language, 'transactionBank')
          : debited.length > 1
            ? translate(language, 'transactionEveryone')
            : nameOf(debited[0]?.playerId);
      const to =
        credited.length === 0
          ? translate(language, 'transactionBank')
          : credited.length > 1
            ? translate(language, 'transactionEveryone')
            : nameOf(credited[0]?.playerId);
      return `${translate(language, 'reversal')} · ${from} → ${to}`;
    }
  }
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
