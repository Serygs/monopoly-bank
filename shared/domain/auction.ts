import type { Auction, Game, GameSettings, Player } from '../types/monopoly.js';
import {
  auctionReserve,
  isAuctionOpen,
  nextBid,
  type AuctionReserveSource,
} from './auction-rules.js';
import { AppError, ConflictError } from '../../worker/services/errors.js';
import {
  InvalidAmountError,
  PlayerBankruptError,
  auctionPayment,
  type BankingOperationResult,
} from './banking.js';

export {
  AUCTION_DURATION_MS,
  AUCTION_RESULT_VISIBLE_MS,
  auctionReserve,
  isAuctionDue,
  isAuctionOpen,
  nextBid,
} from './auction-rules.js';

type ReserveSource = AuctionReserveSource;

export class AuctionAlreadyActiveError extends AppError {
  constructor(auctionId: string) {
    super({
      code: 'AUCTION_ALREADY_ACTIVE',
      message: 'An auction is already running.',
      status: 409,
      details: { auctionId },
    });
  }
}

export class AuctionAlreadyLeadingError extends AppError {
  constructor(playerId: string) {
    super({
      code: 'AUCTION_ALREADY_LEADING',
      message: 'This player already has the leading bid.',
      status: 409,
      details: { playerId },
    });
  }
}

export class AuctionClosedError extends AppError {
  constructor(auctionId: string) {
    super({
      code: 'AUCTION_CLOSED',
      message: 'This auction is closed.',
      status: 409,
      details: { auctionId },
    });
  }
}

export class AuctionBidStaleError extends AppError {
  constructor(auction: Auction) {
    super({
      code: 'AUCTION_BID_STALE',
      message: 'The auction changed. Review the new bid and try again.',
      status: 409,
      details: { auction },
    });
  }
}

export class InvalidBidStepError extends AppError {
  constructor(step: number) {
    super({
      code: 'INVALID_BID_STEP',
      message: 'The bid step is not one of the allowed steps.',
      status: 400,
      details: { field: 'step', step },
    });
  }
}

export class AuctionNotFoundError extends AppError {
  constructor(auctionId: string) {
    super({
      code: 'AUCTION_NOT_FOUND',
      message: 'Auction not found.',
      status: 404,
      details: { auctionId },
    });
  }
}

/** The wallet cannot cover the amount once pending requests and an auction reserve are set aside. */
export class InsufficientAvailableFundsError extends ConflictError {
  constructor(playerId: string, available: number, required: number) {
    super('INSUFFICIENT_AVAILABLE_FUNDS', 'Player does not have enough available funds.', {
      playerId,
      available,
      required,
    });
  }
}

export interface PlaceBidCommand {
  auction: Auction;
  settings: GameSettings;
  bidder: Player;
  expectedVersion: number;
  step: number;
  /** Pending payment-request reservations on the bidder's wallet. */
  reservedByRequests: number;
  nowMs: number;
}

/**
 * Validates a bid and returns its amount. Order matters: a closed or changed auction is reported
 * before anything about the bidder, so a stale button explains itself.
 */
export function validateBid(command: PlaceBidCommand): number {
  const { auction, settings, bidder } = command;
  if (!settings.auctionBidSteps.includes(command.step)) throw new InvalidBidStepError(command.step);
  if (!isAuctionOpen(auction, command.nowMs)) throw new AuctionClosedError(auction.id);
  if (command.expectedVersion !== auction.version) throw new AuctionBidStaleError(auction);
  if (bidder.status === 'BANKRUPT') throw new PlayerBankruptError(bidder.id);
  if (auction.currentBidderId === bidder.id) throw new AuctionAlreadyLeadingError(bidder.id);
  const bid = nextBid(auction, command.step, settings);
  if (!Number.isSafeInteger(bid)) throw new InvalidAmountError(bid);
  const available = bidder.balance - command.reservedByRequests;
  if (available < bid) throw new InsufficientAvailableFundsError(bidder.id, available, bid);
  return bid;
}

/**
 * Every debit must leave the leading bidder at least their reserve. `changes` are the balance
 * changes the operation is about to write.
 */
export function assertReserveRespected(
  changes: readonly { player: Pick<Player, 'id'>; balanceBefore: number; balanceAfter: number }[],
  auction: ReserveSource | null | undefined,
): void {
  if (auction == null) return;
  for (const change of changes) {
    if (change.balanceAfter >= change.balanceBefore) continue;
    const reserve = auctionReserve(auction, change.player.id);
    if (reserve > 0 && change.balanceAfter < reserve)
      throw new InsufficientAvailableFundsError(
        change.player.id,
        change.balanceBefore - reserve,
        change.balanceBefore - change.balanceAfter,
      );
  }
}

export type AuctionSettlementPlan =
  { kind: 'SOLD'; result: BankingOperationResult } | { kind: 'NO_SALE' };

/**
 * What closing a due auction does: a sale when the leader is still active and holds the bid,
 * otherwise no sale (no bid, the leader went bankrupt, or somehow cannot pay any more).
 */
export function planAuctionSettlement(input: {
  game: Game;
  players: readonly Player[];
  auction: Auction;
}): AuctionSettlementPlan {
  const { game, players, auction } = input;
  const leader =
    auction.currentBidderId === null
      ? undefined
      : players.find((player) => player.id === auction.currentBidderId);
  if (
    game.status !== 'ACTIVE' ||
    leader === undefined ||
    leader.status !== 'ACTIVE' ||
    auction.currentBid <= 0 ||
    leader.balance < auction.currentBid
  )
    return { kind: 'NO_SALE' };
  return {
    kind: 'SOLD',
    result: auctionPayment({
      game,
      players,
      playerId: leader.id,
      amount: auction.currentBid,
      lotName: auction.lotName,
    }),
  };
}
