import type { Transaction, TransactionType } from '../types/monopoly.js';

/** How long after a transaction its own player may still reverse it. The game owner has no limit. */
export const REVERSAL_WINDOW_MS = 15 * 60 * 1000;

/** Types a correction can undo. Bankruptcy hands over a whole wallet and a reversal is final. */
const nonReversibleTypes: readonly TransactionType[] = [
  'REVERSAL',
  'BANKRUPTCY_TRANSFER',
  // A mortgage is kept in step with the table's mortgage list, so it is redeemed, not reversed.
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
];

export function isReversibleType(type: TransactionType): boolean {
  return !nonReversibleTypes.includes(type);
}

/**
 * The player who made a transaction, and so may reverse it: the payer of an outgoing payment, or
 * the receiving player of money paid in (from the bank, or by everyone). `null` when the record
 * has no such single player.
 */
export function reversalInitiatorPlayerId(
  transaction: Pick<Transaction, 'type' | 'participants'>,
): string | null {
  const debited = transaction.participants.filter((participant) => participant.balanceDelta < 0);
  const credited = transaction.participants.filter((participant) => participant.balanceDelta > 0);
  switch (transaction.type) {
    case 'PLAYER_TO_PLAYER':
    case 'PAY_RENT':
    case 'PLAYER_TO_BANK':
    case 'PLAYER_TO_ALL':
      return debited.length === 1 ? (debited[0]?.playerId ?? null) : null;
    case 'BANK_TO_PLAYER':
    case 'PASS_GO':
    case 'ALL_TO_PLAYER':
      return credited.length === 1 ? (credited[0]?.playerId ?? null) : null;
    case 'BANKRUPTCY_TRANSFER':
    case 'REVERSAL':
    case 'MORTGAGE':
    case 'MORTGAGE_REDEMPTION':
      return null;
  }
}

/** D1 stores `YYYY-MM-DD HH:MM:SS` in UTC; ISO strings from the live channel already carry a zone. */
export function transactionTimeMs(createdAt: string): number {
  const iso = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  return new Date(iso).getTime();
}

export function isWithinReversalWindow(createdAt: string, now: number): boolean {
  const created = transactionTimeMs(createdAt);
  return Number.isFinite(created) && now - created <= REVERSAL_WINDOW_MS;
}

/**
 * Whether a viewer should be offered "Reverse" for a stored transaction. The Worker repeats the
 * authority check on the server; this only decides what the interface shows.
 */
export function canReverseTransaction(input: {
  transaction: Transaction;
  isOwner: boolean;
  controlledPlayerIds: readonly string[];
  now: number;
}): boolean {
  const { transaction } = input;
  if (!isReversibleType(transaction.type) || transaction.reversedByTransactionId != null)
    return false;
  if (input.isOwner) return true;
  const initiator = reversalInitiatorPlayerId(transaction);
  return (
    initiator !== null &&
    input.controlledPlayerIds.includes(initiator) &&
    isWithinReversalWindow(transaction.createdAt, input.now)
  );
}
