import type { Transaction } from '../../shared/types/monopoly';

function involves(transaction: Transaction, playerId: string): boolean {
  return (
    transaction.initiatorPlayerId === playerId ||
    transaction.participants.some((participant) => participant.playerId === playerId)
  );
}

export function selectRecentEventsForPlayer(
  events: readonly Transaction[],
  playerId: string,
  limit = 3,
): Transaction[] {
  return events
    .filter((transaction) => involves(transaction, playerId))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .slice(0, limit);
}
