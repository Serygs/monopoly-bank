import { describe, expect, it } from 'vitest';
import {
  AuctionAlreadyActiveError,
  AuctionNotFoundError,
  assertReserveRespected,
  auctionReserve,
  isAuctionDue,
  isAuctionOpen,
  nextBid,
  planAuctionSettlement,
  validateBid,
} from './auction.js';
import { buildGameSettings } from './game-rules.js';
import type { BoardSnapshot } from '../board/types.js';
import {
  defaultGameRules,
  type Auction,
  type Game,
  type GameProperty,
  type Player,
} from '../types/monopoly.js';

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

describe('auction refusals carry their code, status, message and details', () => {
  const open = auction({ currentBid: 10, currentBidderId: 'a' });
  const base = {
    auction: open,
    settings,
    bidder: player('b', 1500),
    expectedVersion: 1,
    step: 25,
    reservedByRequests: 0,
    nowMs: NOW,
  };
  const refusal = (command: Parameters<typeof validateBid>[0]): unknown => {
    try {
      validateBid(command);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('reports an unknown step with the step', () => {
    expect(refusal({ ...base, step: 7 })).toMatchObject({
      code: 'INVALID_BID_STEP',
      status: 400,
      message: 'The bid step is not one of the allowed steps.',
      details: { field: 'step', step: 7 },
    });
  });

  it('reports a closed auction with its id, both when over and when settled', () => {
    const expected = {
      code: 'AUCTION_CLOSED',
      status: 409,
      message: 'This auction is closed.',
      details: { auctionId: open.id },
    };
    expect(refusal({ ...base, nowMs: Date.parse(open.endsAt) })).toMatchObject(expected);
    expect(refusal({ ...base, auction: { ...open, state: 'SOLD' } })).toMatchObject(expected);
  });

  it('reports a changed auction with the current auction', () => {
    expect(refusal({ ...base, expectedVersion: 0 })).toMatchObject({
      code: 'AUCTION_BID_STALE',
      status: 409,
      message: 'The auction changed. Review the new bid and try again.',
      details: { auction: open },
    });
  });

  it('reports the leader trying to outbid themselves with their id', () => {
    expect(refusal({ ...base, bidder: player('a') })).toMatchObject({
      code: 'AUCTION_ALREADY_LEADING',
      status: 409,
      message: 'This player already has the leading bid.',
      details: { playerId: 'a' },
    });
  });

  it('reports a bankrupt bidder before the leader check', () => {
    expect(refusal({ ...base, bidder: player('a', 1500, 'BANKRUPT') })).toMatchObject({
      code: 'PLAYER_BANKRUPT',
    });
  });

  it('reports a bid that is not a safe integer', () => {
    expect(
      refusal({
        ...base,
        auction: auction({ currentBid: Number.MAX_SAFE_INTEGER, currentBidderId: 'a' }),
      }),
    ).toMatchObject({ code: 'INVALID_AMOUNT', status: 400 });
  });

  it('reports short available funds with the message, the player and both amounts', () => {
    expect(refusal({ ...base, bidder: player('b', 34) })).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      message: 'Player does not have enough available funds.',
      details: { playerId: 'b', available: 34, required: 35 },
    });
  });
});

describe('bid boundaries', () => {
  const base = {
    auction: auction(),
    settings,
    bidder: player('b'),
    expectedVersion: 1,
    step: 25,
    reservedByRequests: 0,
    nowMs: NOW,
  };

  it('allows a bid equal to the available funds and refuses one unit more', () => {
    expect(validateBid({ ...base, bidder: player('b', 25) })).toBe(25);
    expect(() => validateBid({ ...base, bidder: player('b', 24) })).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 24, required: 25 },
      }),
    );
  });

  it('measures the funds after the amount set aside for pending requests', () => {
    expect(validateBid({ ...base, bidder: player('b', 100), reservedByRequests: 75 })).toBe(25);
    expect(() =>
      validateBid({ ...base, bidder: player('b', 100), reservedByRequests: 76 }),
    ).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' }));
  });

  it('raises a standing bid by the step and never goes below the minimum bid', () => {
    expect(
      validateBid({
        ...base,
        auction: auction({ currentBid: 100, currentBidderId: 'a' }),
        step: 50,
      }),
    ).toBe(150);
    expect(settings.auctionMinBid).toBeGreaterThan(0);
    expect(validateBid({ ...base, settings: { ...settings, auctionMinBid: 40 }, step: 25 })).toBe(
      40,
    );
  });

  it('is open one millisecond before the end and closed at the end', () => {
    const end = Date.parse(auction().endsAt);
    expect(isAuctionOpen(auction(), end - 1)).toBe(true);
    expect(isAuctionOpen(auction(), end)).toBe(false);
    expect(isAuctionDue(auction(), end - 1)).toBe(false);
    expect(isAuctionOpen(auction({ state: 'NO_SALE' }), end - 1)).toBe(false);
  });
});

describe('reserve boundaries', () => {
  const leading = auction({ currentBid: 50, currentBidderId: 'b' });
  const change = (id: string, before: number, after: number) => ({
    player: { id },
    balanceBefore: before,
    balanceAfter: after,
  });

  it('lets an unchanged balance through even when it is below the reserve', () => {
    expect(() => assertReserveRespected([change('b', 40, 40)], leading)).not.toThrow();
  });

  it('does not apply a reserve to a player who is not leading, however low the balance goes', () => {
    expect(() => assertReserveRespected([change('c', 10, -5)], leading)).not.toThrow();
  });

  it('checks every change and reports the first that breaks the reserve', () => {
    expect(() =>
      assertReserveRespected([change('c', 100, 0), change('b', 80, 49)], leading),
    ).toThrow(
      expect.objectContaining({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 30, required: 31 },
      }),
    );
  });

  it('applies no reserve once the auction is closed', () => {
    expect(() =>
      assertReserveRespected([change('b', 100, 0)], { ...leading, state: 'SOLD' }),
    ).not.toThrow();
  });
});

describe('settlement boundaries', () => {
  it('sells when the leader holds exactly the bid and refuses one unit less', () => {
    const sold = planAuctionSettlement({
      game,
      players: [player('a'), player('b', 60)],
      auction: auction({ currentBid: 60, currentBidderId: 'b' }),
    });
    expect(sold.kind).toBe('SOLD');
    expect(
      planAuctionSettlement({
        game,
        players: [player('a'), player('b', 59)],
        auction: auction({ currentBid: 60, currentBidderId: 'b' }),
      }),
    ).toEqual({ kind: 'NO_SALE' });
  });

  it('ends without a sale when the standing bid is zero, even with a leader', () => {
    expect(
      planAuctionSettlement({
        game,
        players: [player('a'), player('b', 60)],
        auction: auction({ currentBid: 0, currentBidderId: 'b' }),
      }),
    ).toEqual({ kind: 'NO_SALE' });
  });

  it('ends without a sale when the leader is not among the players', () => {
    expect(
      planAuctionSettlement({
        game,
        players: [player('a')],
        auction: auction({ currentBid: 10, currentBidderId: 'ghost' }),
      }),
    ).toEqual({ kind: 'NO_SALE' });
  });
});

describe('settlement of a board tile auction', () => {
  const boardSettings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
  const boardGame: Game = { ...game, startingBalance: 15_000_000, settings: boardSettings };
  const board = boardSettings.board as BoardSnapshot;
  const registry = (ownerPlayerId: string | null): GameProperty[] =>
    board.tiles.map((tile) => ({
      gameId: 'g',
      tileId: tile.id,
      ownerPlayerId: tile.id === 'zhitna' ? ownerPlayerId : null,
      mortgaged: false,
      houses: 0,
    }));
  const tileAuction = auction({ currentBid: 600_000, currentBidderId: 'b', tileId: 'zhitna' });
  const buyers = [player('a', 15_000_000), player('b', 15_000_000)];

  it('sells an unowned tile as a property purchase at the winning bid', () => {
    const plan = planAuctionSettlement({
      game: boardGame,
      players: buyers,
      auction: tileAuction,
      property: { board, registry: registry(null) },
    });
    expect(plan.kind).toBe('SOLD');
    if (plan.kind === 'SOLD') {
      expect(plan.result.transaction).toMatchObject({
        type: 'PROPERTY_PURCHASE',
        amount: 600_000,
        tileId: 'zhitna',
        participants: [{ playerId: 'b', balanceDelta: -600_000 }],
      });
      expect(plan.result.transaction.registryChanges).toHaveLength(1);
      expect(plan.result.transaction.registryChanges?.[0]).toMatchObject({
        tileId: 'zhitna',
        after: { ownerPlayerId: 'b' },
      });
    }
  });

  it('ends without a sale when the tile has been taken meanwhile', () => {
    expect(
      planAuctionSettlement({
        game: boardGame,
        players: buyers,
        auction: tileAuction,
        property: { board, registry: registry('a') },
      }),
    ).toEqual({ kind: 'NO_SALE' });
  });

  it('ends without a sale when the registry cannot be checked', () => {
    expect(
      planAuctionSettlement({ game: boardGame, players: buyers, auction: tileAuction }),
    ).toEqual({ kind: 'NO_SALE' });
  });

  it('sells a free-text lot as an auction payment even when a registry is passed', () => {
    const plan = planAuctionSettlement({
      game: boardGame,
      players: buyers,
      auction: auction({ currentBid: 600_000, currentBidderId: 'b', tileId: null }),
      property: { board, registry: registry(null) },
    });
    expect(plan.kind).toBe('SOLD');
    if (plan.kind === 'SOLD')
      expect(plan.result.transaction).toMatchObject({ type: 'AUCTION_PAYMENT', amount: 600_000 });
  });
});

describe('auction lookup errors', () => {
  it('reports a running auction with its id', () => {
    expect(new AuctionAlreadyActiveError('a-1')).toMatchObject({
      code: 'AUCTION_ALREADY_ACTIVE',
      status: 409,
      message: 'An auction is already running.',
      details: { auctionId: 'a-1' },
    });
  });

  it('reports a missing auction with its id', () => {
    expect(new AuctionNotFoundError('a-2')).toMatchObject({
      code: 'AUCTION_NOT_FOUND',
      status: 404,
      message: 'Auction not found.',
      details: { auctionId: 'a-2' },
    });
  });
});
