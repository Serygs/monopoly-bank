import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import { translate, type Language } from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from './money';

export function transactionDescription(transaction: Transaction, players: Player[], language: Language = 'en'): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const negative = transaction.participants.find((participant) => participant.balanceDelta < 0);
  const positive = transaction.participants.find((participant) => participant.balanceDelta > 0);
  const player = translate(language, 'playerFallback');
  const nameOf = (id: string | undefined) => id === undefined ? player : names.get(id) ?? player;
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;
    case 'PAY_RENT': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · ${translate(language, 'rent')}`;
    case 'PLAYER_TO_BANK': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')}`;
    case 'BANK_TO_PLAYER': return `${translate(language, 'transactionBank')} → ${nameOf(positive?.playerId)}`;
    case 'PLAYER_TO_ALL': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionEveryone')}`;
    case 'ALL_TO_PLAYER': return `${translate(language, 'transactionEveryone')} → ${nameOf(positive?.playerId)}`;
    case 'PASS_GO': return `${nameOf(positive?.playerId)} · ${translate(language, 'passedGo')}`;
    case 'BANKRUPTCY_TRANSFER': return translate(language, 'bankruptcyTransactionDescription', { source: nameOf(negative?.playerId), destination: nameOf(positive?.playerId) });
    case 'PROPERTY_RENT': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · ${translate(language, 'rent')}`;
    case 'PROPERTY_PURCHASE': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')} · ${translate(language, 'boughtProperty')}`;
    case 'PROPERTY_BUILD': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')} · ${translate(language, 'builtHouses')}`;
    case 'PROPERTY_SELL_BUILDINGS': return `${translate(language, 'transactionBank')} → ${nameOf(positive?.playerId)} · ${translate(language, 'soldBuildings')}`;
    case 'PROPERTY_MORTGAGE': return `${translate(language, 'transactionBank')} → ${nameOf(positive?.playerId)} · ${translate(language, 'mortgagedProperty')}`;
    case 'PROPERTY_UNMORTGAGE': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')} · ${translate(language, 'redeemedProperty')}`;
    case 'PROPERTY_AUCTION': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')} · ${translate(language, 'wonAuction')}`;
    case 'PROPERTY_TRADE': return transaction.participants.length === 0 ? translate(language, 'tradedProperty') : `${nameOf(negative?.playerId)} ↔ ${nameOf(positive?.playerId)} · ${translate(language, 'tradedProperty')}`;
    case 'JAIL_BAIL': return `${nameOf(negative?.playerId)} → ${translate(language, 'transactionBank')} · ${translate(language, 'paidBail')}`;
  }
}

export function transactionAmount(transaction: Transaction, currency: Currency, language: Language = 'en'): string {
  const money = (value: number) => formatMoney(value, currency);
  if (transaction.type === 'PLAYER_TO_ALL' || transaction.type === 'ALL_TO_PLAYER') return translate(language, 'eachAmount', { amount: money(transaction.amount), total: money(transaction.totalAmount) });
  if (transaction.type === 'PASS_GO') return `+${money(transaction.amount)}`;
  if (transaction.type === 'PROPERTY_BUILD' || transaction.type === 'PROPERTY_SELL_BUILDINGS') return transaction.totalAmount === transaction.amount ? money(transaction.amount) : translate(language, 'eachAmount', { amount: money(transaction.amount), total: money(transaction.totalAmount) });
  return money(transaction.amount);
}

export function playerTransactionAmount(transaction: Transaction, playerId: string, currency: Currency): string | null {
  const delta = transaction.participants.find((participant) => participant.playerId === playerId)?.balanceDelta;
  if (delta === undefined) return null;
  return formatMoneyDelta(delta, currency);
}
