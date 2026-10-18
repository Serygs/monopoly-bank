import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionNotFoundError } from '../shared/domain/auction.js';
import { ResourceNotFoundError } from './services/errors.js';
import {
  AUCTION,
  CMD,
  G,
  START,
  gameDetails,
  harness,
  post,
  sentTo,
  socket,
} from './test-support/game-session-harness.js';

const endsAt = new Date(START + 30_000).toISOString();
const deadline = { gameId: G, auctionId: AUCTION, endsAt: START + 30_000 };
const sold = {
  auction: { id: AUCTION, state: 'SOLD', endsAt },
  transaction: { id: 'tx-sale', type: 'AUCTION_PAYMENT' },
  players: [{ id: 'p1' }],
};
const SETTLE_KEY = `auction-settle:${AUCTION}`;

function due() {
  const observer = socket({ userId: 'other' });
  const setup = harness({ sockets: [observer], stored: { auctionDeadline: deadline } });
  setup.auctions.settleDue.mockResolvedValue(sold);
  return { ...setup, observer };
}

describe('auction settlement bookkeeping', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 30_000);
  });
  afterEach(() => vi.useRealTimers());

  it('claims the settlement as the system under a command id derived from the auction', async () => {
    const { session, ledger } = due();
    await session.alarm();
    expect(ledger.claim).toHaveBeenCalledWith({
      gameId: G,
      commandId: SETTLE_KEY,
      actorId: 'system',
      commandType: 'AUCTION_SETTLE',
      payloadHash: AUCTION,
    });
  });

  it('records the settlement in the ledger with the sale transaction', async () => {
    const { session, ledger } = due();
    await session.alarm();
    expect(ledger.complete).toHaveBeenCalledWith({
      gameId: G,
      commandId: SETTLE_KEY,
      status: 200,
      result: sold,
      transactionId: 'tx-sale',
    });
  });

  it('records no transaction for an auction that ended without a sale', async () => {
    const { session, ledger, auctions, observer } = due();
    const noSale = { auction: { id: AUCTION, state: 'NO_SALE', endsAt } };
    auctions.settleDue.mockResolvedValue(noSale);
    await session.alarm();
    expect(ledger.complete).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null }));
    expect(sentTo(observer)).toEqual([
      { type: 'AUCTION_UPDATED', stateVersion: 1, auction: noSale.auction },
    ]);
  });

  it('commits nothing for a settlement that has a transaction but no players, or the reverse', async () => {
    for (const partial of [
      { auction: sold.auction, transaction: sold.transaction },
      { auction: sold.auction, players: sold.players },
    ]) {
      const { session, auctions, observer } = due();
      auctions.settleDue.mockResolvedValue(partial);
      await session.alarm();
      expect(sentTo(observer).map((event) => event.type)).toEqual(['AUCTION_UPDATED']);
    }
  });

  it('does nothing and keeps the deadline when the auction was not due after all', async () => {
    const { session, auctions, observer, storage, ledger } = due();
    auctions.settleDue.mockResolvedValue(null);
    await session.alarm();
    expect(sentTo(observer)).toEqual([]);
    expect(ledger.complete).not.toHaveBeenCalled();
    expect(storage.get('auctionDeadline')).toEqual(deadline);
  });

  it('does not settle twice when the ledger says it is already done, and clears the deadline', async () => {
    const { session, auctions, claimed, storage, alarm, observer } = due();
    claimed.set(SETTLE_KEY, 'COMPLETED');
    await session.alarm();
    expect(auctions.settleDue).not.toHaveBeenCalled();
    expect(sentTo(observer)).toEqual([]);
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });

  it.each([
    ['the auction is gone', new AuctionNotFoundError(AUCTION)],
    ['the game is gone', new ResourceNotFoundError('Game')],
  ])('drops the deadline and still reports the failure when %s', async (_label, error) => {
    const { session, auctions, storage, alarm } = due();
    auctions.settleDue.mockRejectedValue(error);
    await expect(session.alarm()).rejects.toBe(error);
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });

  it('keeps the deadline for any other failure so the alarm retries', async () => {
    const { session, auctions, storage } = due();
    auctions.settleDue.mockRejectedValue(new Error('D1 unavailable'));
    await expect(session.alarm()).rejects.toThrow('D1 unavailable');
    expect(storage.get('auctionDeadline')).toEqual(deadline);
  });

  it('clears the alarm even when the stored deadline vanished while settling', async () => {
    const { session, auctions, storage, alarm } = due();
    auctions.settleDue.mockImplementation(async () => {
      storage.delete('auctionDeadline');
      return sold;
    });
    await expect(session.alarm()).resolves.toBeUndefined();
    expect(alarm()).toBeNull();
  });

  it('retries shortly after a settlement that is still pending, never in the past', async () => {
    vi.setSystemTime(START + 29_500);
    const { session, alarm, auctions } = due();
    await session.alarm();
    expect(auctions.settleDue).not.toHaveBeenCalled();
    expect(alarm()).toBe(START + 30_500);
  });

  it('keeps the stored end when it is further away than the retry delay', async () => {
    vi.setSystemTime(START + 10_000);
    const { session, alarm } = due();
    await session.alarm();
    expect(alarm()).toBe(START + 30_000);
  });

  it('leaves the alarm unset when no auction is running', async () => {
    const { session, alarm, auctions } = harness();
    await session.alarm();
    expect(alarm()).toBeNull();
    expect(auctions.getCurrent).not.toHaveBeenCalled();
  });

  it('looks for an orphaned running auction once per wake, not before every command', async () => {
    const { session, auctions } = harness();
    for (const id of [CMD, '00000000-0000-4000-8000-0000000000c2']) {
      await session.mutate(G, 'u', post({ type: 'START_GAME', commandId: id }));
    }
    expect(auctions.getCurrent).toHaveBeenCalledTimes(1);
    expect(auctions.getCurrent).toHaveBeenCalledWith(G);
  });

  it('ignores a closed auction found while looking for an orphan', async () => {
    const { session, auctions, storage, alarm } = harness();
    auctions.getCurrent.mockResolvedValue({ id: AUCTION, state: 'SOLD', endsAt });
    await session.mutate(G, 'u', post({ type: 'START_GAME' }));
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });

  it('does not look again after it armed an orphaned auction itself', async () => {
    const { session, auctions, storage } = harness();
    auctions.getCurrent.mockResolvedValue({ id: AUCTION, state: 'ACTIVE', endsAt });
    await session.mutate(G, 'u', post({ type: 'START_GAME' }));
    expect(storage.get('auctionDeadline')).toEqual(deadline);
    storage.delete('auctionDeadline');
    await session.mutate(
      G,
      'u',
      post({ type: 'START_GAME', commandId: '00000000-0000-4000-8000-0000000000c3' }),
    );
    expect(auctions.getCurrent).toHaveBeenCalledTimes(1);
  });
});

describe('what a settlement tells the table', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 30_000);
  });
  afterEach(() => vi.useRealTimers());

  it('adds the jackpot and the properties as they stand after the sale', async () => {
    const { session, gameService, observer } = due();
    gameService.getGame.mockResolvedValue(
      gameDetails('ACTIVE', { jackpot: 120, properties: [{ tileId: 'a' }] }),
    );
    await session.alarm();
    expect(sentTo(observer)[1]).toEqual({
      type: 'GAME_COMMITTED',
      stateVersion: 1,
      transaction: sold.transaction,
      players: sold.players,
      jackpot: 120,
      properties: [{ tileId: 'a' }],
    });
  });

  it('adds nothing optional when the game has none of it', async () => {
    const { session, observer } = due();
    await session.alarm();
    expect(sentTo(observer)[1]).toEqual({
      type: 'GAME_COMMITTED',
      stateVersion: 1,
      transaction: sold.transaction,
      players: sold.players,
    });
  });

  it('adds the loans and the cooldowns with the bank-loans rule, an empty list when there are none', async () => {
    const withLoans = due();
    withLoans.gameService.getGame.mockResolvedValue({
      game: { id: G, status: 'ACTIVE', rules: { bankLoans: true } },
      players: [],
      loans: [{ id: 'loan-1' }],
      bankLoanCooldowns: [{ playerId: 'p1' }],
    });
    await withLoans.session.alarm();
    expect(sentTo(withLoans.observer)[1]).toMatchObject({
      loans: [{ id: 'loan-1' }],
      bankLoanCooldowns: [{ playerId: 'p1' }],
    });

    const bare = due();
    bare.gameService.getGame.mockResolvedValue({
      game: { id: G, status: 'ACTIVE', rules: { bankLoans: true } },
      players: [],
    });
    await bare.session.alarm();
    const event = sentTo(bare.observer)[1] as Record<string, unknown>;
    expect(event.loans).toEqual([]);
    expect(event).not.toHaveProperty('bankLoanCooldowns');
  });

  it('leaves the loans out when the rule is off, even if the game has some', async () => {
    const { session, gameService, observer } = due();
    gameService.getGame.mockResolvedValue(gameDetails('ACTIVE', { loans: [{ id: 'loan-1' }] }));
    await session.alarm();
    expect(sentTo(observer)[1]).not.toHaveProperty('loans');
  });
});
