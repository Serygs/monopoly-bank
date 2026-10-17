import type { Transaction, TransactionType } from '../types/monopoly.js';

/** How long after a transaction its own player may still reverse it. The game owner has no limit. */
export const REVERSAL_WINDOW_MS = 15 * 60 * 1000;

/** Types a correction can undo. Bankruptcy hands over a whole wallet and a reversal is final. */
const nonReversibleTypes: readonly TransactionType[] = [
  'REVERSAL',
  'BANKRUPTCY_TRANSFER',
  // A free-text mortgage is kept in step with the table's mortgage list, so it is redeemed, not
  // reversed; a board mortgage is registry-backed and can be (see `reversibleTransaction`).
  // A loan is kept in step with the loans table, so it is repaid, not reversed.
  'LOAN_ISSUE',
  'LOAN_REPAYMENT',
  // The Free Parking pot is changed only by its own two operations, so a correction is a new one.
  'TO_JACKPOT',
  'JACKPOT_PAYOUT',
];

export function isReversibleType(type: TransactionType): boolean {
  return !nonReversibleTypes.includes(type);
}

/**
 * Whether a stored transaction can be undone at all. A mortgage or redemption is reversible only
 * when it concerned a board tile (registry-backed); the free-text ones of games without a board
 * stay final.
 */
export function reversibleTransaction(transaction: Pick<Transaction, 'type' | 'tileId'>): boolean {
  if (transaction.type === 'MORTGAGE' || transaction.type === 'MORTGAGE_REDEMPTION')
    return transaction.tileId != null;
  return isReversibleType(transaction.type);
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
    case 'MORTGAGE_REDEMPTION':
    case 'PROPERTY_BUILD':
    case 'AUCTION_PAYMENT':
    case 'PROPERTY_PURCHASE':
    case 'PLAYER_TO_ALL':
      return debited.length === 1 ? (debited[0]?.playerId ?? null) : null;
    case 'BANK_TO_PLAYER':
    case 'PASS_GO':
    case 'MORTGAGE':
    case 'PROPERTY_SELL_BUILDING':
    case 'ALL_TO_PLAYER':
      return credited.length === 1 ? (credited[0]?.playerId ?? null) : null;
    case 'BANKRUPTCY_TRANSFER':
    case 'REVERSAL':
    case 'LOAN_ISSUE':
    case 'LOAN_REPAYMENT':
    case 'TO_JACKPOT':
    case 'JACKPOT_PAYOUT':
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
 * Later operations that build on money a transaction moved: a mortgage, a loan, an auction
 * payment, a Free Parking step or a bankruptcy by one of the same players. Undoing the earlier
 * transaction beneath them would leave those records without their cause, so it is refused.
 */
const dependentTypes: readonly TransactionType[] = [
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
  'LOAN_ISSUE',
  'LOAN_REPAYMENT',
  'AUCTION_PAYMENT',
  'TO_JACKPOT',
  'JACKPOT_PAYOUT',
  'BANKRUPTCY_TRANSFER',
];

/** Types that change the property registry: a later one on the same tile builds on the earlier. */
const registryTypes: readonly TransactionType[] = [
  'PROPERTY_PURCHASE',
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
  'AUCTION_PAYMENT',
  'PAY_RENT',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
];

/**
 * Later operations on any tile of the colour group that invalidate an original's effect on it:
 * a purchase can complete the group (rent doubling, building), a building changes the rent of its
 * group mates and what may be mortgaged, a redemption allows building.
 */
const groupBlockers: Partial<Record<TransactionType, readonly TransactionType[]>> = {
  PROPERTY_PURCHASE: ['PAY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'],
  AUCTION_PAYMENT: ['PAY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'],
  PROPERTY_BUILD: ['PAY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING', 'MORTGAGE'],
  PROPERTY_SELL_BUILDING: ['PAY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING', 'MORTGAGE'],
  MORTGAGE_REDEMPTION: ['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'],
};

/**
 * The first later transaction that depends on `original`, or null. `later` is every transaction
 * written after it; one that was itself reversed no longer counts. A later registry operation on
 * the same tile also blocks, whoever made it. `groupTileIds` are the tiles of the original tile's
 * colour group: a purchase can change the rent of its group mates (a full group doubles it), so a
 * rent paid on any of them blocks the reversal of a purchase. Callers without the board omit it.
 */
export function findReversalDependency(
  original: Pick<Transaction, 'id' | 'participants' | 'type'> & { tileId?: string | null },
  later: readonly Transaction[],
  groupTileIds: readonly string[] = [],
): Transaction | null {
  const playerIds = new Set(original.participants.map((participant) => participant.playerId));
  return (
    later.find(
      (candidate) =>
        candidate.id !== original.id &&
        candidate.reversedByTransactionId == null &&
        ((dependentTypes.includes(candidate.type) &&
          candidate.participants.some((participant) => playerIds.has(participant.playerId))) ||
          (original.tileId != null &&
            candidate.tileId === original.tileId &&
            registryTypes.includes(candidate.type)) ||
          (candidate.tileId != null &&
            groupTileIds.includes(candidate.tileId) &&
            (groupBlockers[original.type]?.includes(candidate.type) ?? false))),
    ) ?? null
  );
}

/** Why a viewer who made a transaction cannot reverse it now. */
export type ReversalBlockReason = 'WINDOW_EXPIRED' | 'LATER_OPERATION';

/**
 * What to show for a stored transaction: `allowed`, `hidden` (the viewer did not make it, or it
 * is final), or `blocked` with the reason. `later` is whatever newer transactions the caller
 * knows; the Worker checks them all again.
 */
export function reversalAvailability(input: {
  transaction: Transaction;
  isOwner: boolean;
  controlledPlayerIds: readonly string[];
  now: number;
  later?: readonly Transaction[];
  /** Tiles of the transaction's colour group, when the caller has the board. */
  groupTileIds?: readonly string[];
}):
  | { status: 'allowed' }
  | { status: 'hidden' }
  | { status: 'blocked'; reason: ReversalBlockReason; dependency: Transaction | null } {
  const { transaction } = input;
  if (!reversibleTransaction(transaction) || transaction.reversedByTransactionId != null)
    return { status: 'hidden' };
  const initiator = reversalInitiatorPlayerId(transaction);
  const isActor = initiator !== null && input.controlledPlayerIds.includes(initiator);
  if (!input.isOwner && !isActor) return { status: 'hidden' };
  if (!input.isOwner && !isWithinReversalWindow(transaction.createdAt, input.now))
    return { status: 'blocked', reason: 'WINDOW_EXPIRED', dependency: null };
  const dependency = findReversalDependency(transaction, input.later ?? [], input.groupTileIds);
  if (dependency !== null) return { status: 'blocked', reason: 'LATER_OPERATION', dependency };
  return { status: 'allowed' };
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
  later?: readonly Transaction[];
  groupTileIds?: readonly string[];
}): boolean {
  return reversalAvailability(input).status === 'allowed';
}
