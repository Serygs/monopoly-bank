import { describe, expect, it } from 'vitest';
import {
  assertReserveRespected,
  auctionReserve,
  isAuctionDue,
  isAuctionOpen,
  nextBid,
  planAuctionSettlement,
  validateBid,
} from './auction.js';
import { buildGameSettings } from './game-rules.js';
import { defaultGameRules, type Auction, type Game, type Player } from '../types/monopoly.js';

const settings = buildGameSettings(1500); // steps 10 / 25 / 50 / 100
const game: Game = {
  id: 'g',
  name: 'G',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, auctions: true },
  settings,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '',
  finishedAt: null,
};
const player = (id: string, balance = 1500, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'g',
  name: id,
  color: '#000',
  balance,
  status,
  isInJail: false,
  consecutiveDoubles: 0,
  userId: null,
  createdAt: '',
});
const auction = (patch: Partial<Auction> = {}): Auction => ({
  id: 'a0000000-0000-4000-8000-00000000000f',
  gameId: 'g',
  lotName: 'Lot',
  initiatorPlayerId: 'a',
  state: 'ACTIVE',
  currentBid: 0,
  currentBidderId: null,
  version: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-01-01T00:00:30.000Z',
  serverTime: '',
  settledTransactionId: null,
  ...patch,
});
const NOW = Date.parse('2026-01-01T00:00:10.000Z');

describe('auction reserve', () => {
  it('reserves the leading bid on the leader of an active auction only', () => {
    const leading = auction({ currentBid: 50, currentBidderId: 'b' });
    expect(auctionReserve(leading, 'b')).toBe(50);
    expect(auctionReserve(leading, 'c')).toBe(0);
    expect(auctionReserve({ ...leading, state: 'SOLD' }, 'b')).toBe(0);
    expect(auctionReserve({ ...leading, currentBidderId: null }, 'b')).toBe(0);
    expect(auctionReserve(null, 'b')).toBe(0);
  });

  it('refuses a debit that eats into the reserve and allows the rest', () => {
    const leading = auction({ currentBid: 50, currentBidderId: 'b' });
    const change = (id: string, before: number, after: number) => ({
      player: { id },
      balanceBefore: before,
      balanceAfter: after,
    });
    expect(() => assertReserveRespected([change('b', 100, 49)], leading)).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 50, required: 51 },
      }),
    );
    expect(() => assertReserveRespected([change('b', 100, 50)], leading)).not.toThrow();
    expect(() => assertReserveRespected([change('b', 10, 20)], leading)).not.toThrow();
    expect(() => assertReserveRespected([change('c', 100, 0)], leading)).not.toThrow();
    expect(() => assertReserveRespected([change('b', 100, 0)], null)).not.toThrow();
  });
});

describe('bids', () => {
  const base = {
    auction: auction(),
    settings,
    bidder: player('b'),
    expectedVersion: 1,
    step: 25,
    reservedByRequests: 0,
    nowMs: NOW,
  };

  it('first bid is the step, later bids add to the standing bid', () => {
    expect(validateBid(base)).toBe(25);
    expect(nextBid(auction({ currentBid: 25 }), 50, settings)).toBe(75);
    expect(nextBid(auction(), 1, { auctionMinBid: 10 })).toBe(10);
  });

  it('applies the checks in order', () => {
    expect(() => validateBid({ ...base, step: 7 })).toThrow(
      expect.objectContaining({ code: 'INVALID_BID_STEP' }),
    );
    expect(() => validateBid({ ...base, nowMs: Date.parse(base.auction.endsAt) })).toThrow(
      expect.objectContaining({ code: 'AUCTION_CLOSED' }),
    );
    expect(() => validateBid({ ...base, auction: auction({ state: 'SOLD' }) })).toThrow(
      expect.objectContaining({ code: 'AUCTION_CLOSED' }),
    );
    expect(() => validateBid({ ...base, expectedVersion: 0 })).toThrow(
      expect.objectContaining({ code: 'AUCTION_BID_STALE' }),
    );
    expect(() => validateBid({ ...base, bidder: player('b', 1500, 'BANKRUPT') })).toThrow(
      expect.objectContaining({ code: 'PLAYER_BANKRUPT' }),
    );
    expect(() =>
      validateBid({ ...base, auction: auction({ currentBid: 10, currentBidderId: 'b' }) }),
    ).toThrow(expect.objectContaining({ code: 'AUCTION_ALREADY_LEADING' }));
  });

  it('counts pending payment-request reservations against the bid', () => {
    expect(() =>
      validateBid({ ...base, bidder: player('b', 100), reservedByRequests: 80 }),
    ).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 20, required: 25 },
      }),
    );
  });

  it('knows when an auction is open or due', () => {
    expect(isAuctionOpen(auction(), NOW)).toBe(true);
    expect(isAuctionDue(auction(), NOW)).toBe(false);
    expect(isAuctionDue(auction(), Date.parse(auction().endsAt))).toBe(true);
    expect(isAuctionDue(auction({ state: 'NO_SALE' }), NOW + 1e6)).toBe(false);
  });
});

describe('settlement plan', () => {
  const players = [player('a'), player('b', 100), player('c', 20, 'BANKRUPT')];

  it('sells to an active leader who holds the bid', () => {
    const plan = planAuctionSettlement({
      game,
      players,
      auction: auction({ currentBid: 60, currentBidderId: 'b' }),
    });
    expect(plan.kind).toBe('SOLD');
    if (plan.kind === 'SOLD')
      expect(plan.result.transaction).toMatchObject({
        type: 'AUCTION_PAYMENT',
        amount: 60,
        comment: 'Lot',
        participants: [{ playerId: 'b', balanceDelta: -60 }],
      });
  });

  it.each([
    ['no bid', auction()],
    ['a withdrawn bid', auction({ currentBid: 60, currentBidderId: null })],
    ['a bankrupt leader', auction({ currentBid: 10, currentBidderId: 'c' })],
    ['a leader who cannot pay', auction({ currentBid: 101, currentBidderId: 'b' })],
  ])('ends without a sale on %s', (_name, current) => {
    expect(planAuctionSettlement({ game, players, auction: current })).toEqual({ kind: 'NO_SALE' });
  });

  it('ends without a sale in a game that is no longer active', () => {
    expect(
      planAuctionSettlement({
        game: { ...game, status: 'FINISHED' },
        players,
        auction: auction({ currentBid: 60, currentBidderId: 'b' }),
      }).kind,
    ).toBe('NO_SALE');
  });
});
