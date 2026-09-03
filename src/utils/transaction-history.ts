import type { Player, Transaction } from '../../shared/types/monopoly';
import { languageLocale, type Language } from '../i18n/translations';
import { formatThousands } from './money';

const labels: Record<Language, { player: string; rent: string; bank: string; everyone: string; passGo: string; each: string; total: string }> = {
  en: { player: 'Player', rent: 'Rent', bank: 'Bank', everyone: 'Everyone', passGo: 'Pass GO', each: 'each', total: 'total' },
  uk: { player: 'Гравець', rent: 'Оренда', bank: 'Банк', everyone: 'Усі', passGo: 'Прохід СТАРТУ', each: 'кожен', total: 'загалом' },
};

export function transactionDescription(transaction: Transaction, players: Player[], language: Language = 'en'): string {
  const text = labels[language];
  const names = new Map(players.map((player) => [player.id, player.name]));
  const negative = transaction.participants.find((participant) => participant.balanceDelta < 0);
  const positive = transaction.participants.find((participant) => participant.balanceDelta > 0);
  const nameOf = (id: string | undefined) => id === undefined ? text.player : names.get(id) ?? text.player;
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;
    case 'PAY_RENT': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · ${text.rent}`;
    case 'PLAYER_TO_BANK': return `${nameOf(negative?.playerId)} → ${text.bank}`;
    case 'BANK_TO_PLAYER': return `${text.bank} → ${nameOf(positive?.playerId)}`;
    case 'PLAYER_TO_ALL': return `${nameOf(negative?.playerId)} → ${text.everyone}`;
    case 'ALL_TO_PLAYER': return `${text.everyone} → ${nameOf(positive?.playerId)}`;
    case 'PASS_GO': return `${nameOf(positive?.playerId)} · ${text.passGo}`;
  }
}

export function transactionAmount(transaction: Transaction, language: Language = 'en'): string {
  const text = labels[language];
  const money = (value: number) => `${formatThousands(value, languageLocale(language))}k`;
  if (transaction.type === 'PLAYER_TO_ALL' || transaction.type === 'ALL_TO_PLAYER') return `${money(transaction.amount)} ${text.each} · ${money(transaction.totalAmount)} ${text.total}`;
  if (transaction.type === 'PASS_GO') return `+${money(transaction.amount)}`;
  return money(transaction.amount);
}

export function playerTransactionAmount(transaction: Transaction, playerId: string, language: Language = 'en'): string | null {
  const delta = transaction.participants.find((participant) => participant.playerId === playerId)?.balanceDelta;
  if (delta === undefined) return null;
  return `${delta >= 0 ? '+' : '-'}${formatThousands(Math.abs(delta), languageLocale(language))}k`;
}
