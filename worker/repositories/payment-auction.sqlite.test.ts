// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PaymentRequest } from '../../shared/contracts/api.js';
import type { PendingTransaction, PlayerBalanceChange } from '../../shared/domain/banking.js';
import { AUCTION_RESULT_VISIBLE_MS } from '../../shared/domain/auction-rules.js';
import type { Player } from '../../shared/types/monopoly.js';
import { D1AuctionRepository } from './auction-repository.js';
import { D1PaymentRequestRepository } from './payment-request-repository.js';
import {
  d1,
  exec,
  failingD1,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

const future = '2999-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';

function playerOf(id: string, balance: number): Player {
  return { id, gameId: 'game', name: id, color: '#000', balance, status: 'ACTIVE', createdAt: '' };
}

function change(id: string, before: number, after: number): PlayerBalanceChange {
  return {
    player: playerOf(id, before),
    balanceBefore: before,
    balanceAfter: after,
    balanceDelta: after - before,
  };
}

describe('D1PaymentRequestRepository on SQLite', () => {
  let database: DatabaseSync;
  let repository: D1PaymentRequestRepository;

  const request = (
    id: string,
    overrides: Partial<PaymentRequest> = {},
  ): Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'> => ({
    id,
    kind: 'PAYMENT',
    gameId: 'game',
    payerPlayerId: 'a',
    recipientPlayerId: 'b',
    creatorPlayerId: 'b',
    approverPlayerId: 'a',
    amount: 40,
    comment: 'rent',
    state: 'PENDING',
    expiresAt: future,
    ...overrides,
  });
  const stateOf = (id: string) =>
    rows<{ state: string }>(database, 'SELECT state FROM payment_requests WHERE id = ?', id)[0]
      ?.state;
  const balances = () =>
    rows<{ id: string; balance: number }>(
      database,
      "SELECT id, balance FROM players WHERE game_id = 'game' ORDER BY id",
    );
  const payment = (amount = 40): PendingTransaction => ({
    gameId: 'game',
    type: 'PLAYER_TO_PLAYER',
    amount,
    totalAmount: amount,
    comment: 'rent',
    participants: [
      { playerId: 'a', balanceDelta: -amount },
      { playerId: 'b', balanceDelta: amount },
    ],
  });

  beforeEach(async () => {
    database = await migrated();
    seedUser(database, 'owner');
    seedGame(database, 'game', { owner: 'owner' });
    seedGame(database, 'other', { owner: 'owner' });
    for (const id of ['a', 'b', 'c']) seedPlayer(database, id, 'game', 1000);
    seedPlayer(database, 'x', 'other');
    seedPlayer(database, 'y', 'other');
    repository = new D1PaymentRequestRepository(d1(database));
  });

  it('creates a request and reads it back, ignoring a repeated id', async () => {
    await repository.create(request('r1'));
    await repository.create(request('r1', { amount: 999 }));
    expect(await repository.getById('game', 'r1')).toMatchObject({
      id: 'r1',
      kind: 'PAYMENT',
      gameId: 'game',
      payerPlayerId: 'a',
      recipientPlayerId: 'b',
      creatorPlayerId: 'b',
      approverPlayerId: 'a',
      amount: 40,
      comment: 'rent',
      state: 'PENDING',
      expiresAt: future,
      resolvedAt: null,
      transactionId: null,
    });
    expect((await repository.getById('game', 'r1'))?.createdAt).not.toBe('');
    expect(await repository.getById('other', 'r1')).toBeNull();
    expect(await repository.getById('game', 'missing')).toBeNull();
  });

  it('lists pending requests of the given wallets as approver or creator, oldest first', async () => {
    await repository.create(request('r1'));
    await repository.create(
      request('r2', {
        payerPlayerId: 'b',
        recipientPlayerId: 'a',
        creatorPlayerId: 'a',
        approverPlayerId: 'b',
      }),
    );
    await repository.create(
      request('r3', {
        payerPlayerId: 'b',
        recipientPlayerId: 'c',
        creatorPlayerId: 'c',
        approverPlayerId: 'b',
      }),
    );
    exec(
      database,
      "UPDATE payment_requests SET created_at = '2026-01-01 00:00:03' WHERE id = 'r1'",
    );
    exec(
      database,
      "UPDATE payment_requests SET created_at = '2026-01-01 00:00:01' WHERE id = 'r2'",
    );
    exec(
      database,
      "UPDATE payment_requests SET created_at = '2026-01-01 00:00:02' WHERE id = 'r3'",
    );
    expect((await repository.listForPayers('game', ['a'])).map((item) => item.id)).toEqual([
      'r2',
      'r1',
    ]);
    expect((await repository.listForPayers('game', ['c'])).map((item) => item.id)).toEqual(['r3']);
    expect((await repository.listForPayers('game', ['a', 'c'])).map((item) => item.id)).toEqual([
      'r2',
      'r3',
      'r1',
    ]);
    expect(await repository.listForPayers('other', ['a'])).toEqual([]);
  });

  it('lists nothing and expires nothing for an empty wallet list', async () => {
    await repository.create(request('stale', { expiresAt: past }));
    expect(await repository.listForPayers('game', [])).toEqual([]);
    expect(stateOf('stale')).toBe('PENDING');
  });

  it('expires stale requests when listing and leaves resolved ones out', async () => {
    await repository.create(request('stale', { expiresAt: past }));
    await repository.create(request('done', { state: 'DECLINED' }));
    expect(await repository.listForPayers('game', ['a'])).toEqual([]);
    expect(stateOf('stale')).toBe('EXPIRED');
    expect(
      rows<{ resolved_at: string | null }>(
        database,
        "SELECT resolved_at FROM payment_requests WHERE id = 'stale'",
      )[0].resolved_at,
    ).not.toBeNull();
  });

  it('adds up what a payer has reserved in pending, unexpired requests', async () => {
    expect(await repository.pendingReservedAmount('game', 'a')).toBe(0);
    await repository.create(request('r1', { amount: 40 }));
    await repository.create(request('r2', { amount: 25 }));
    await repository.create(request('r3', { amount: 7, state: 'CANCELLED' }));
    await repository.create(request('r4', { amount: 5, expiresAt: past }));
    await repository.create(
      request('r5', { amount: 3, payerPlayerId: 'c', approverPlayerId: 'c' }),
    );
    expect(await repository.pendingReservedAmount('game', 'a')).toBe(65);
    expect(await repository.pendingReservedAmount('game', 'c')).toBe(3);
    expect(await repository.pendingReservedAmount('other', 'a')).toBe(0);
    expect(stateOf('r4')).toBe('EXPIRED');
  });

  it('expires only the pending requests of one game that ran out', async () => {
    await repository.create(request('stale', { expiresAt: past }));
    await repository.create(request('fresh'));
    await repository.expirePending('other');
    expect(stateOf('stale')).toBe('PENDING');
    await repository.expirePending('game');
    expect(stateOf('stale')).toBe('EXPIRED');
    expect(stateOf('fresh')).toBe('PENDING');
  });

  it('resolves a pending request once as declined or cancelled', async () => {
    await repository.create(request('r1'));
    await repository.create(request('r2'));
    expect(await repository.resolve('r1', 'DECLINED')).toBe(true);
    expect(await repository.resolve('r1', 'CANCELLED')).toBe(false);
    expect(await repository.resolve('r2', 'CANCELLED')).toBe(true);
    expect(await repository.resolve('missing', 'DECLINED')).toBe(false);
    expect(stateOf('r1')).toBe('DECLINED');
    expect(stateOf('r2')).toBe('CANCELLED');
    expect(
      rows<{ resolved_at: string | null }>(
        database,
        "SELECT resolved_at FROM payment_requests WHERE id = 'r1'",
      )[0].resolved_at,
    ).not.toBeNull();
  });

  describe('settle', () => {
    it('moves the money, records the transaction and accepts the request in one batch', async () => {
      await repository.create(request('r1'));
      await repository.settle({
        requestId: 'r1',
        transactionId: 'tx1',
        transaction: payment(),
        balanceChanges: [change('a', 1000, 960), change('b', 1000, 1040)],
      });
      expect(balances()).toEqual([
        { id: 'a', balance: 960 },
        { id: 'b', balance: 1040 },
        { id: 'c', balance: 1000 },
      ]);
      expect(
        rows(database, 'SELECT id, game_id, type, amount, total_amount, comment FROM transactions'),
      ).toEqual([
        {
          id: 'tx1',
          game_id: 'game',
          type: 'PLAYER_TO_PLAYER',
          amount: 40,
          total_amount: 40,
          comment: 'rent',
        },
      ]);
      expect(
        rows(
          database,
          'SELECT player_id, balance_delta FROM transaction_participants ORDER BY player_id',
        ),
      ).toEqual([
        { player_id: 'a', balance_delta: -40 },
        { player_id: 'b', balance_delta: 40 },
      ]);
      expect(await repository.getById('game', 'r1')).toMatchObject({
        state: 'ACCEPTED',
        transactionId: 'tx1',
      });
      expect(
        rows<{ resolved_at: string | null }>(
          database,
          'SELECT resolved_at FROM payment_requests',
        )[0].resolved_at,
      ).not.toBeNull();
      expect(rows(database, "SELECT id, recent_amounts FROM games WHERE id = 'game'")).toEqual([
        { id: 'game', recent_amounts: '[40]' },
      ]);
    });

    it('keeps only the five latest recent amounts and moves a repeated one to the front', async () => {
      for (const [index, amount] of [10, 20, 30, 40, 50].entries()) {
        exec(
          database,
          "INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES ('game', ?, ?)",
          amount,
          `2024-01-01 00:00:0${index}`,
        );
      }
      await repository.create(request('r1', { amount: 60 }));
      await repository.settle({
        requestId: 'r1',
        transactionId: 'tx1',
        transaction: payment(60),
        balanceChanges: [change('a', 1000, 940), change('b', 1000, 1060)],
      });
      expect(rows(database, "SELECT recent_amounts FROM games WHERE id = 'game'")).toEqual([
        { recent_amounts: '[60,50,40,30,20]' },
      ]);
    });

    it('rolls everything back when a balance changed since it was read', async () => {
      await repository.create(request('r1'));
      await expect(
        repository.settle({
          requestId: 'r1',
          transactionId: 'tx1',
          transaction: payment(),
          balanceChanges: [change('a', 900, 860), change('b', 1000, 1040)],
        }),
      ).rejects.toMatchObject({ code: 'DATABASE_ERROR', operation: 'settlePaymentRequest' });
      expect(balances().map((row) => row.balance)).toEqual([1000, 1000, 1000]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
      expect(stateOf('r1')).toBe('PENDING');
      expect(rows(database, "SELECT recent_amounts FROM games WHERE id = 'game'")).toEqual([
        { recent_amounts: null },
      ]);
    });

    it('rolls everything back when a payer would go negative', async () => {
      await repository.create(request('r1', { amount: 1500 }));
      await expect(
        repository.settle({
          requestId: 'r1',
          transactionId: 'tx1',
          transaction: payment(1500),
          balanceChanges: [change('a', 1000, -500), change('b', 1000, 2500)],
        }),
      ).rejects.toMatchObject({ operation: 'settlePaymentRequest' });
      expect(balances().map((row) => row.balance)).toEqual([1000, 1000, 1000]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('can settle a transaction without balance changes', async () => {
      await repository.create(request('r1'));
      await repository.settle({
        requestId: 'r1',
        transactionId: 'tx1',
        transaction: { ...payment(), participants: [] },
        balanceChanges: [],
      });
      expect(stateOf('r1')).toBe('ACCEPTED');
      expect(balances().map((row) => row.balance)).toEqual([1000, 1000, 1000]);
    });

    it('creates the loan together with the accepted loan request', async () => {
      await repository.create(
        request('r1', {
          kind: 'LOAN',
          payerPlayerId: 'b',
          recipientPlayerId: 'a',
          creatorPlayerId: 'a',
          approverPlayerId: 'b',
          amount: 300,
        }),
      );
      await repository.settle({
        requestId: 'r1',
        transactionId: 'tx1',
        transaction: {
          gameId: 'game',
          type: 'LOAN_ISSUE',
          amount: 300,
          totalAmount: 300,
          comment: null,
          participants: [
            { playerId: 'b', balanceDelta: -300 },
            { playerId: 'a', balanceDelta: 300 },
          ],
          newLoan: { lenderPlayerId: 'b', borrowerPlayerId: 'a', principal: 300 },
        },
        balanceChanges: [change('b', 1000, 700), change('a', 1000, 1300)],
      });
      expect(
        rows(
          database,
          'SELECT id, lender_kind, lender_player_id, borrower_player_id, principal, state FROM loans',
        ),
      ).toEqual([
        {
          id: 'tx1',
          lender_kind: 'PLAYER',
          lender_player_id: 'b',
          borrower_player_id: 'a',
          principal: 300,
          state: 'ACTIVE',
        },
      ]);
    });

    it('rolls back a loan whose request expired before settling', async () => {
      await repository.create(
        request('r1', {
          kind: 'LOAN',
          payerPlayerId: 'b',
          recipientPlayerId: 'a',
          creatorPlayerId: 'a',
          approverPlayerId: 'b',
          amount: 300,
          expiresAt: past,
        }),
      );
      await expect(
        repository.settle({
          requestId: 'r1',
          transactionId: 'tx1',
          transaction: {
            gameId: 'game',
            type: 'LOAN_ISSUE',
            amount: 300,
            totalAmount: 300,
            comment: null,
            participants: [
              { playerId: 'b', balanceDelta: -300 },
              { playerId: 'a', balanceDelta: 300 },
            ],
            newLoan: { lenderPlayerId: 'b', borrowerPlayerId: 'a', principal: 300 },
          },
          balanceChanges: [change('b', 1000, 700), change('a', 1000, 1300)],
        }),
      ).rejects.toMatchObject({ operation: 'settlePaymentRequest' });
      expect(balances().map((row) => row.balance)).toEqual([1000, 1000, 1000]);
      expect(rows(database, 'SELECT id FROM loans')).toEqual([]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('does not move money for a payment request that expired before settling', async () => {
      await repository.create(request('r1', { expiresAt: past }));
      await repository
        .settle({
          requestId: 'r1',
          transactionId: 'tx1',
          transaction: payment(),
          balanceChanges: [change('a', 1000, 960), change('b', 1000, 1040)],
        })
        .catch(() => undefined);
      expect(balances().map((row) => row.balance)).toEqual([1000, 1000, 1000]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('wraps a failing batch in a database error without leaking the cause', async () => {
      const failing = new D1PaymentRequestRepository(failingD1(new Error('secret')));
      await expect(
        failing.settle({
          requestId: 'r1',
          transactionId: 'tx1',
          transaction: payment(),
          balanceChanges: [change('a', 1, 0), change('b', 1, 2)],
        }),
      ).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        operation: 'settlePaymentRequest',
        message: 'Internal server error.',
      });
    });
  });
});

describe('D1AuctionRepository on SQLite', () => {
  let database: DatabaseSync;
  let repository: D1AuctionRepository;
  const start = '2026-01-01T00:00:00.000Z';
  const end = '2026-01-01T00:00:30.000Z';

  const create = (
    id: string,
    extra: { tileId?: string | null; endsAt?: string; startedAt?: string } = {},
  ) =>
    repository.create({
      id,
      gameId: 'game',
      lotName: `Lot ${id}`,
      initiatorPlayerId: 'a',
      startedAt: extra.startedAt ?? start,
      endsAt: extra.endsAt ?? end,
      ...(extra.tileId === undefined ? {} : { tileId: extra.tileId }),
    });

  beforeEach(async () => {
    database = await migrated();
    seedUser(database, 'owner');
    seedGame(database, 'game', { owner: 'owner' });
    seedGame(database, 'other', { owner: 'owner' });
    seedPlayer(database, 'a', 'game', 1000);
    seedPlayer(database, 'b', 'game', 1000);
    repository = new D1AuctionRepository(d1(database));
  });

  it('creates an auction as active with no bid, and finds it', async () => {
    await create('au1');
    const active = await repository.getActive('game');
    expect(active).toMatchObject({
      id: 'au1',
      gameId: 'game',
      lotName: 'Lot au1',
      initiatorPlayerId: 'a',
      state: 'ACTIVE',
      currentBid: 0,
      currentBidderId: null,
      version: 1,
      startedAt: start,
      endsAt: end,
      settledTransactionId: null,
    });
    expect(active).not.toHaveProperty('tileId');
    expect(Number.isNaN(Date.parse(active?.serverTime ?? ''))).toBe(false);
    expect(await repository.getActive('other')).toBeNull();
    expect(await repository.getById('game', 'au1')).toMatchObject({ id: 'au1' });
    expect(await repository.getById('other', 'au1')).toBeNull();
  });

  it('exposes the board tile of a tile auction', async () => {
    await create('au1', { tileId: 'tile-3' });
    expect(await repository.getActive('game')).toMatchObject({ tileId: 'tile-3' });
    exec(database, 'UPDATE auctions SET tile_id = NULL');
    expect(await repository.getActive('game')).not.toHaveProperty('tileId');
  });

  it('wraps storage failures with the operation name', async () => {
    const failing = new D1AuctionRepository(failingD1(new Error('io')));
    await expect(
      failing.create({
        id: 'x',
        gameId: 'game',
        lotName: 'l',
        initiatorPlayerId: 'a',
        startedAt: start,
        endsAt: end,
      }),
    ).rejects.toMatchObject({ operation: 'createAuction' });
    await expect(
      failing.placeBid({
        gameId: 'game',
        auctionId: 'x',
        expectedVersion: 1,
        bid: 10,
        bidderPlayerId: 'a',
        nowIso: start,
        minEndsAtIso: end,
      }),
    ).rejects.toMatchObject({ operation: 'placeBid' });
    await expect(failing.closeWithoutSale('game', 'x', 1)).rejects.toMatchObject({
      operation: 'closeAuctionWithoutSale',
    });
  });

  it('allows only one running auction per game', async () => {
    await create('au1');
    await expect(create('au2')).rejects.toMatchObject({ operation: 'createAuction' });
    await create('au3').catch(() => undefined);
    expect(rows(database, 'SELECT id FROM auctions')).toEqual([{ id: 'au1' }]);
  });

  it('shows a closed auction as current for two minutes after it ended, newest end first', async () => {
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    expect(await repository.getCurrent('game', now)).toBeNull();
    await create('old', { endsAt: new Date(now - AUCTION_RESULT_VISIBLE_MS - 1000).toISOString() });
    exec(database, "UPDATE auctions SET state = 'NO_SALE' WHERE id = 'old'");
    expect(await repository.getCurrent('game', now)).toBeNull();
    await create('recent-a', { endsAt: new Date(now - 60_000).toISOString() });
    exec(database, "UPDATE auctions SET state = 'NO_SALE' WHERE id = 'recent-a'");
    await create('recent-b', { endsAt: new Date(now - 30_000).toISOString() });
    exec(database, "UPDATE auctions SET state = 'NO_SALE' WHERE id = 'recent-b'");
    expect((await repository.getCurrent('game', now))?.id).toBe('recent-b');
    await create('running');
    expect((await repository.getCurrent('game', now))?.id).toBe('running');
    expect(await repository.getCurrent('other', now)).toBeNull();
  });

  it('keeps an auction visible right up to the cutoff and hides it at the boundary', async () => {
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    await create('edge', { endsAt: new Date(now - AUCTION_RESULT_VISIBLE_MS).toISOString() });
    exec(database, "UPDATE auctions SET state = 'NO_SALE'");
    expect(await repository.getCurrent('game', now)).toBeNull();
    expect((await repository.getCurrent('game', now - 1))?.id).toBe('edge');
  });

  describe('placeBid', () => {
    const bid = (overrides: Partial<Parameters<D1AuctionRepository['placeBid']>[0]> = {}) =>
      repository.placeBid({
        gameId: 'game',
        auctionId: 'au1',
        expectedVersion: 1,
        bid: 100,
        bidderPlayerId: 'b',
        nowIso: '2026-01-01T00:00:10.000Z',
        minEndsAtIso: '2026-01-01T00:00:20.000Z',
        ...overrides,
      });
    const current = () =>
      rows<{
        current_bid: number;
        current_bidder_id: string | null;
        version: number;
        ends_at: string;
      }>(database, 'SELECT current_bid, current_bidder_id, version, ends_at FROM auctions')[0];

    beforeEach(async () => {
      await create('au1');
    });

    it('records a higher bid, bumps the version and keeps a later end', async () => {
      expect(await bid()).toBe(true);
      expect(current()).toEqual({
        current_bid: 100,
        current_bidder_id: 'b',
        version: 2,
        ends_at: end,
      });
    });

    it('extends the end when the minimum end is later', async () => {
      expect(await bid({ minEndsAtIso: '2026-01-01T00:00:50.000Z' })).toBe(true);
      expect(current().ends_at).toBe('2026-01-01T00:00:50.000Z');
    });

    it('refuses a stale version, an unknown auction or another game', async () => {
      expect(await bid({ expectedVersion: 2 })).toBe(false);
      expect(await bid({ auctionId: 'missing' })).toBe(false);
      expect(await bid({ gameId: 'other' })).toBe(false);
      expect(current()).toMatchObject({ current_bid: 0, version: 1 });
    });

    it('refuses a bid at or after the end', async () => {
      expect(await bid({ nowIso: end })).toBe(false);
      expect(await bid({ nowIso: '2026-01-01T00:00:31.000Z' })).toBe(false);
      expect(await bid({ nowIso: '2026-01-01T00:00:29.999Z' })).toBe(true);
    });

    it('refuses a bid that does not beat the current one, or from the leader', async () => {
      expect(await bid({ bid: 100 })).toBe(true);
      expect(await bid({ bid: 100, bidderPlayerId: 'a', expectedVersion: 2 })).toBe(false);
      expect(await bid({ bid: 90, bidderPlayerId: 'a', expectedVersion: 2 })).toBe(false);
      expect(await bid({ bid: 150, bidderPlayerId: 'b', expectedVersion: 2 })).toBe(false);
      expect(await bid({ bid: 101, bidderPlayerId: 'a', expectedVersion: 2 })).toBe(true);
      expect(current()).toMatchObject({ current_bid: 101, current_bidder_id: 'a', version: 3 });
    });

    it('refuses a bidder who cannot cover the bid, counting pending payment requests', async () => {
      expect(await bid({ bid: 1001 })).toBe(false);
      expect(await bid({ bid: 1000 })).toBe(true);
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at) VALUES ('r1', 'game', 'a', 'b', 'b', 'a', 400, 'PENDING', ?)",
        future,
      );
      expect(await bid({ bid: 601, bidderPlayerId: 'a', expectedVersion: 2 })).toBe(false);
      expect(await bid({ bid: 1001, bidderPlayerId: 'a', expectedVersion: 2 })).toBe(false);
    });

    it('allows exactly the available balance and ignores expired or resolved requests', async () => {
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at) VALUES ('r1', 'game', 'b', 'a', 'a', 'b', 400, 'PENDING', ?)",
        future,
      );
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at) VALUES ('r2', 'game', 'b', 'a', 'a', 'b', 300, 'PENDING', ?)",
        past,
      );
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, resolved_at) VALUES ('r3', 'game', 'b', 'a', 'a', 'b', 200, 'DECLINED', ?, '2026-01-01')",
        future,
      );
      expect(await bid({ bid: 601 })).toBe(false);
      expect(await bid({ bid: 600 })).toBe(true);
    });

    it('refuses a bankrupt bidder', async () => {
      exec(database, "UPDATE players SET status = 'BANKRUPT' WHERE id = 'b'");
      expect(await bid()).toBe(false);
    });

    it('refuses a bid on a closed auction', async () => {
      exec(database, "UPDATE auctions SET state = 'NO_SALE'");
      expect(await bid()).toBe(false);
    });
  });

  describe('closeWithoutSale', () => {
    it('closes an active auction at the expected version once', async () => {
      await create('au1');
      expect(await repository.closeWithoutSale('game', 'au1', 2)).toBe(false);
      expect(await repository.closeWithoutSale('other', 'au1', 1)).toBe(false);
      expect(await repository.closeWithoutSale('game', 'missing', 1)).toBe(false);
      expect(await repository.closeWithoutSale('game', 'au1', 1)).toBe(true);
      expect(await repository.closeWithoutSale('game', 'au1', 2)).toBe(false);
      expect(await repository.getById('game', 'au1')).toMatchObject({
        state: 'NO_SALE',
        version: 2,
      });
      expect(await repository.getActive('game')).toBeNull();
    });
  });
});
