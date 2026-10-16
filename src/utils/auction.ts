import { useEffect, useMemo, useState } from 'react';
import { auctionReserve, nextBid } from '../../shared/domain/auction-rules';
import type { Auction, Player } from '../../shared/types/monopoly';

/** How often the countdown redraws; the figure only shows whole seconds. */
const CLOCK_TICK_MS = 250;

/**
 * The leading bid is held back on the leader's wallet while the auction runs. This is the Worker's
 * own rule (shared/domain/auction-rules.ts), so the two cannot drift; the Worker stays the
 * authority and refuses any spend that would eat into it.
 */
export const auctionReserveFor = auctionReserve;

/** Cash the player can still spend: the balance minus what their leading bid holds back. */
export function availableCash(player: Player, auction: Auction | null | undefined): number {
  return player.balance - auctionReserveFor(auction, player.id);
}

/** What the bid would become after raising it by `step` (never below the minimum bid). */
export function nextBidAmount(auction: Auction, step: number, minBid: number): number {
  return nextBid(auction, step, { auctionMinBid: minBid });
}

/**
 * Keeps the newest of two auction snapshots, so a late REST answer cannot overwrite a newer live
 * event. A different auction wins when it started later; the same one when its version is not older.
 */
export function newerAuction(current: Auction | null, next: Auction | null): Auction | null {
  if (current === null || next === null) return next ?? current;
  if (current.id !== next.id) return next.startedAt >= current.startedAt ? next : current;
  return next.version >= current.version ? next : current;
}

/** Server time minus device time when the snapshot arrived; add it to `Date.now()` to read the server clock. */
export function serverClockOffset(auction: Auction): number {
  return Date.parse(auction.serverTime) - Date.now();
}

/** Milliseconds left before the auction closes, by the server's clock; never negative. */
export function remainingMs(auction: Auction, offset: number, now = Date.now()): number {
  return Math.max(0, Date.parse(auction.endsAt) - (now + offset));
}

/**
 * Counts down to `endsAt`. The offset between the server's clock and this device's is taken once
 * per received snapshot, so a skewed device clock still shows the server's time.
 */
export function useAuctionCountdown(auction: Auction): number {
  // A new snapshot (new object) refreshes the offset; ticks only redraw.
  const offset = useMemo(() => serverClockOffset(auction), [auction]);
  const [now, setNow] = useState(() => Date.now());
  const running = auction.state === 'ACTIVE';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  return remainingMs(auction, offset, Math.max(now, 0));
}
