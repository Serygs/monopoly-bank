import type { Auction, GameSettings } from '../types/monopoly.js';

/**
 * Pure auction rules with no Worker imports, so the client can use them too. The Worker-side
 * validation and errors live in `auction.ts`, which re-exports everything here.
 */

/** The server sets `endsAt` this long after the start. */
export const AUCTION_DURATION_MS = 30_000;
/** A bid never leaves less than this much time: a later `endsAt` is kept, an earlier one is moved. */
export const AUCTION_BID_EXTENSION_MS = 10_000;
/** A closed auction stays in the game details this long, so every device sees the result. */
export const AUCTION_RESULT_VISIBLE_MS = 2 * 60 * 1000;

export type AuctionReserveSource = Pick<Auction, 'state' | 'currentBid' | 'currentBidderId'>;

/**
 * The leading bid of an ACTIVE auction is reserved on the leader's wallet: they cannot spend it on
 * anything else, and outbidding releases it. Derived on read, never stored.
 */
export function auctionReserve(
  auction: AuctionReserveSource | null | undefined,
  playerId: string,
): number {
  if (auction == null || auction.state !== 'ACTIVE') return 0;
  return auction.currentBidderId === playerId ? auction.currentBid : 0;
}

/** Whether a bid is still allowed: ACTIVE and before the end. */
export function isAuctionOpen(auction: Pick<Auction, 'state' | 'endsAt'>, nowMs: number): boolean {
  return auction.state === 'ACTIVE' && nowMs < Date.parse(auction.endsAt);
}

/** Whether an ACTIVE auction has reached its end and must be settled. */
export function isAuctionDue(auction: Pick<Auction, 'state' | 'endsAt'>, nowMs: number): boolean {
  return auction.state === 'ACTIVE' && nowMs >= Date.parse(auction.endsAt);
}

/** The bid a step produces: the current bid plus the step, never below the minimum bid. */
export function nextBid(
  auction: Pick<Auction, 'currentBid'>,
  step: number,
  settings: Pick<GameSettings, 'auctionMinBid'>,
): number {
  return Math.max(auction.currentBid + step, settings.auctionMinBid);
}
