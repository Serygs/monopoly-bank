import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import type { Language } from '../i18n/translations';
import { formatMoney, formatMoneyDelta } from './money';

interface HistoryLabels {
  player: string; rent: string; bank: string; everyone: string; passGo: string; each: string; total: string;
  purchase: string; build: string; sellBuildings: string; mortgage: string; unmortgage: string; auction: string; trade: string; bail: string;
}

const labels: Record<Language, HistoryLabels> = {
  en: { player: 'Player', rent: 'Rent', bank: 'Bank', everyone: 'Everyone', passGo: 'Pass GO', each: 'each', total: 'total', purchase: 'Bought a deed', build: 'Built', sellBuildings: 'Sold buildings', mortgage: 'Mortgaged a deed', unmortgage: 'Redeemed a mortgage', auction: 'Won an auction', trade: 'Trade', bail: 'Jail bail' },
  uk: { player: 'Гравець', rent: 'Оренда', bank: 'Банк', everyone: 'Усі', passGo: 'Прохід СТАРТУ', each: 'кожен', total: 'загалом', purchase: 'Купівля поля', build: 'Забудова', sellBuildings: 'Продаж будівель', mortgage: 'Застава поля', unmortgage: 'Викуп застави', auction: 'Аукціон', trade: 'Угода', bail: 'Вихід під заставу' },
};

/**
 * One line per ledger entry. Board transactions carry no space reference on
 * the wire (see `Transaction`), so they are labelled by what happened and who
 * paid whom; the deed itself is visible on the property panel.
 */
export function transactionDescription(transaction: Transaction, players: Player[], language: Language = 'en'): string {
  const text = labels[language];
  const names = new Map(players.map((player) => [player.id, player.name]));
  const negative = transaction.participants.find((participant) => participant.balanceDelta < 0);
  const positive = transaction.participants.find((participant) => participant.balanceDelta > 0);
  const nameOf = (id: string | undefined) => id === undefined ? text.player : names.get(id) ?? text.player;
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;
    case 'PAY_RENT':
    case 'PROPERTY_RENT': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · ${text.rent}`;
    case 'PLAYER_TO_BANK': return `${nameOf(negative?.playerId)} → ${text.bank}`;
    case 'BANK_TO_PLAYER': return `${text.bank} → ${nameOf(positive?.playerId)}`;
    case 'PLAYER_TO_ALL': return `${nameOf(negative?.playerId)} → ${text.everyone}`;
    case 'ALL_TO_PLAYER': return `${text.everyone} → ${nameOf(positive?.playerId)}`;
    case 'PASS_GO': return `${nameOf(positive?.playerId)} · ${text.passGo}`;
    case 'BANKRUPTCY_TRANSFER': return `${nameOf(negative?.playerId)} declared bankruptcy to ${nameOf(positive?.playerId)}`;
    case 'PROPERTY_PURCHASE': return `${nameOf(negative?.playerId)} → ${text.bank} · ${text.purchase}`;
    case 'PROPERTY_BUILD': return `${nameOf(negative?.playerId)} → ${text.bank} · ${text.build}`;
    case 'PROPERTY_SELL_BUILDINGS': return `${text.bank} → ${nameOf(positive?.playerId)} · ${text.sellBuildings}`;
    case 'PROPERTY_MORTGAGE': return `${text.bank} → ${nameOf(positive?.playerId)} · ${text.mortgage}`;
    case 'PROPERTY_UNMORTGAGE': return `${nameOf(negative?.playerId)} → ${text.bank} · ${text.unmortgage}`;
    case 'PROPERTY_AUCTION': return `${nameOf(negative?.playerId)} → ${text.bank} · ${text.auction}`;
    case 'PROPERTY_TRADE': return transaction.participants.length === 0 ? text.trade : `${nameOf(negative?.playerId)} ↔ ${nameOf(positive?.playerId)} · ${text.trade}`;
    case 'JAIL_BAIL': return `${nameOf(negative?.playerId)} → ${text.bank} · ${text.bail}`;
  }
}

export function transactionAmount(transaction: Transaction, currency: Currency, language: Language = 'en'): string {
  const text = labels[language];
  const money = (value: number) => formatMoney(value, currency);
  if (transaction.type === 'PLAYER_TO_ALL' || transaction.type === 'ALL_TO_PLAYER') return `${money(transaction.amount)} ${text.each} · ${money(transaction.totalAmount)} ${text.total}`;
  if (transaction.type === 'PASS_GO') return `+${money(transaction.amount)}`;
  if (transaction.type === 'PROPERTY_BUILD' || transaction.type === 'PROPERTY_SELL_BUILDINGS') return transaction.totalAmount === transaction.amount ? money(transaction.amount) : `${money(transaction.amount)} ${text.each} · ${money(transaction.totalAmount)} ${text.total}`;
  return money(transaction.amount);
}

export function playerTransactionAmount(transaction: Transaction, playerId: string, currency: Currency): string | null {
  const delta = transaction.participants.find((participant) => participant.playerId === playerId)?.balanceDelta;
  if (delta === undefined) return null;
  return formatMoneyDelta(delta, currency);
}
