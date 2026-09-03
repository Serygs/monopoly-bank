import type { Player, Transaction } from '../../shared/types/monopoly';
import { formatThousands } from './money';

export function transactionDescription(transaction: Transaction, players: Player[]): string {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const negative = transaction.participants.find((participant) => participant.balanceDelta < 0);
  const positive = transaction.participants.find((participant) => participant.balanceDelta > 0);
  const nameOf = (id: string | undefined) => id === undefined ? 'Player' : names.get(id) ?? 'Player';
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)}`;
    case 'PAY_RENT': return `${nameOf(negative?.playerId)} → ${nameOf(positive?.playerId)} · Rent`;
    case 'PLAYER_TO_BANK': return `${nameOf(negative?.playerId)} → Bank`;
    case 'BANK_TO_PLAYER': return `Bank → ${nameOf(positive?.playerId)}`;
    case 'PLAYER_TO_ALL': return `${nameOf(negative?.playerId)} → Everyone`;
    case 'ALL_TO_PLAYER': return `Everyone → ${nameOf(positive?.playerId)}`;
    case 'PASS_GO': return `${nameOf(positive?.playerId)} · Pass GO`;
  }
}

export function transactionAmount(transaction: Transaction): string {
  const money = (value: number) => `${formatThousands(value)}k`;
  if (transaction.type === 'PLAYER_TO_ALL' || transaction.type === 'ALL_TO_PLAYER') return `${money(transaction.amount)} each · ${money(transaction.totalAmount)} total`;
  if (transaction.type === 'PASS_GO') return `+${money(transaction.amount)}`;
  return money(transaction.amount);
}

export function playerTransactionAmount(transaction: Transaction, playerId: string): string | null {
  const delta = transaction.participants.find((participant) => participant.playerId === playerId)?.balanceDelta;
  if (delta === undefined) return null;
  return `${delta >= 0 ? '+' : '-'}${formatThousands(Math.abs(delta))}k`;
}
