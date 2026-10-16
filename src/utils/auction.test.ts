import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auction, Player } from '../../shared/types/monopoly';
import {
  auctionReserveFor,
  availableCash,
  newerAuction,
  nextBidAmount,
  remainingMs,
  useAuctionCountdown,
} from './auction';

const auction: Auction = {
  id: 'a1',
  gameId: 'g1',
  lotName: 'Park Place',
  initiatorPlayerId: 'p1',
  state: 'ACTIVE',
  currentBid: 50,
  currentBidderId: 'p2',
  version: 2,
  startedAt: '2026-10-16T12:00:00.000Z',
  endsAt: '2026-10-16T12:00:30.000Z',
  serverTime: '2026-10-16T12:00:10.000Z',
  settledTransactionId: null,
};
const bidder: Player = {
  id: 'p2',
  gameId: 'g1',
  name: 'Taras',
  color: '#000',
  balance: 200,
  createdAt: '',
};

describe('auction helpers', () => {
  it('reserves the leading bid on the leader of an active auction only', () => {
    expect(auctionReserveFor(auction, 'p2')).toBe(50);
    expect(auctionReserveFor(auction, 'p1')).toBe(0);
    expect(auctionReserveFor({ ...auction, state: 'SOLD' }, 'p2')).toBe(0);
    expect(auctionReserveFor(null, 'p2')).toBe(0);
    expect(availableCash(bidder, auction)).toBe(150);
  });

  it('raises the bid by the step but never below the minimum bid', () => {
    expect(nextBidAmount(auction, 10, 5)).toBe(60);
    expect(nextBidAmount({ ...auction, currentBid: 0 }, 2.5, 5)).toBe(5);
  });

  it('keeps the newest snapshot', () => {
    const older = { ...auction, version: 1 };
    expect(newerAuction(auction, older)).toBe(auction);
    expect(newerAuction(older, auction)).toBe(auction);
    expect(newerAuction(null, auction)).toBe(auction);
    const next = { ...auction, id: 'a2', startedAt: '2026-10-16T12:05:00.000Z' };
    expect(newerAuction(auction, next)).toBe(next);
    expect(newerAuction(next, auction)).toBe(next);
  });
});

describe('auction countdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down to endsAt by the server clock, however skewed the device clock is', () => {
    // The device clock is 5 minutes ahead of the server.
    vi.setSystemTime(new Date('2026-10-16T12:05:10.000Z'));
    expect(remainingMs(auction, Date.parse(auction.serverTime) - Date.now())).toBe(20_000);

    const { result } = renderHook(() => useAuctionCountdown(auction));
    expect(result.current).toBe(20_000);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(15_000);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(0);
  });
});
