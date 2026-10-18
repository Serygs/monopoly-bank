import type { Transaction, TransactionType } from '../types/monopoly.js';
import { type ParticipantSide, soleParticipant } from './participants.js';

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
const REVERSAL_INITIATOR_SIDE: Partial<Record<TransactionType, ParticipantSide>> = {
  PLAYER_TO_PLAYER: 'DEBIT',
  PAY_RENT: 'DEBIT',
  PLAYER_TO_BANK: 'DEBIT',
  MORTGAGE_REDEMPTION: 'DEBIT',
  PROPERTY_BUILD: 'DEBIT',
  AUCTION_PAYMENT: 'DEBIT',
  PROPERTY_PURCHASE: 'DEBIT',
  PLAYER_TO_ALL: 'DEBIT',
  BANK_TO_PLAYER: 'CREDIT',
  PASS_GO: 'CREDIT',
  MORTGAGE: 'CREDIT',
  PROPERTY_SELL_BUILDING: 'CREDIT',
  ALL_TO_PLAYER: 'CREDIT',
};

export function reversalInitiatorPlayerId(
  transaction: Pick<Transaction, 'type' | 'participants'> & {
    initiatorPlayerId?: string | null;
  },
): string | null {
  if (transaction.type === 'PROPERTY_TRANSFER') return transaction.initiatorPlayerId ?? null;
  const side = REVERSAL_INITIATOR_SIDE[transaction.type];
  return side === undefined ? null : soleParticipant(transaction.participants, side);
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
  'PROPERTY_TRANSFER',
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
  PROPERTY_TRANSFER: ['PAY_RENT', 'PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'],
};

/**
 * The first later transaction that depends on `original`, or null. `later` is every transaction
 * written after it; one that was itself reversed no longer counts. A later registry operation on
 * the same tile also blocks, whoever made it. `groupTileIds` are the tiles of the original tile's
 * colour group: a purchase can change the rent of its group mates (a full group doubles it), so a
 * rent paid on any of them blocks the reversal of a purchase. Callers without the board omit it.
 */
export function findReversalDependency(
  original: Pick<Transaction, 'id' | 'participants' | 'type'> & {
    tileId?: string | null;
    tileIds?: readonly string[];
  },
  later: readonly Transaction[],
  groupTileIds: readonly string[] = [],
): Transaction | null {
  const originalTiles = tilesOf(original);
  const playerIds = new Set(original.participants.map((participant) => participant.playerId));
  return (
    later.find(
      (candidate) =>
        candidate.id !== original.id &&
        candidate.reversedByTransactionId == null &&
        ((dependentTypes.includes(candidate.type) &&
          candidate.participants.some((participant) => playerIds.has(participant.playerId))) ||
          (registryTypes.includes(candidate.type) &&
            tilesOf(candidate).some((tileId) => originalTiles.includes(tileId))) ||
          (tilesOf(candidate).some((tileId) => groupTileIds.includes(tileId)) &&
            (groupBlockers[original.type]?.includes(candidate.type) ?? false))),
    ) ?? null
  );
}

/** The tiles a transaction concerned: one (`tileId`) or, for a trade, every one that changed hands. */
function tilesOf(item: { tileId?: string | null; tileIds?: readonly string[] }): readonly string[] {
  return item.tileIds ?? (item.tileId == null ? [] : [item.tileId]);
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
