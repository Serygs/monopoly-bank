// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { planAuctionSettlement } from '../../shared/domain/auction.js';
import { DefaultAuctionService } from '../services/auction-service.js';
import { DefaultBankingService } from '../services/banking-service.js';
import { D1AuctionRepository } from './auction-repository.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1LoanRepository } from './loan-repository.js';
import { D1MortgageRepository } from './mortgage-repository.js';
import { D1PaymentRequestRepository } from './payment-request-repository.js';
import { D1PlayerRepository } from './player-repository.js';
import { D1TransactionRepository } from './transaction-repository.js';

/** The slice of D1 the repositories use, backed by a real SQLite database. */
function d1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: SQLInputValue[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next as SQLInputValue[];
        return statement;
      },
      first: async () => (database.prepare(sql).get(...values) as unknown) ?? null,
      all: async () => ({ results: database.prepare(sql).all(...values) as unknown[] }),
      run: async () => {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    database.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

const AUCTION = 'a0000000-0000-4000-8000-000000000001';
const SECOND = 'a0000000-0000-4000-8000-000000000002';
const START = Date.parse('2026-01-01T00:00:00.000Z');
// Starting balance 1500: unit 10, steps 10 / 25 / 50 / 100, minimum bid 10.
const steps = buildGameSettings(1500).auctionBidSteps;

describe('auctions (real SQLite)', () => {
  let database: DatabaseSync;
  let clock: number;
  let auctions: DefaultAuctionService;
  let banking: DefaultBankingService;

  const setup = (rule: boolean) => {
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, rule_auctions, settings_snapshot)
       VALUES ('game', 'Auction', 1500, 200, 'K', 'ACTIVE', 'FAST', ${rule ? 1 : 0}, '${JSON.stringify(buildGameSettings(1500))}');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500),
         ('c', 'game', 'Cy', '#333333', 1500)`,
    );
    const db = d1(database);
    const common = {
      games: new D1GameRepository(db),
      players: new D1PlayerRepository(db),
      transactions: new D1TransactionRepository(db),
      operations: new D1BankingOperationRepository(db),
      paymentRequests: new D1PaymentRequestRepository(db),
      auctions: new D1AuctionRepository(db),
    };
    auctions = new DefaultAuctionService({ ...common, now: () => clock });
    let next = 0;
    banking = new DefaultBankingService({
      ...common,
      mortgages: new D1MortgageRepository(db),
      loans: new D1LoanRepository(db),
      createId: () => `b0000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`,
    });
  };

  beforeEach(async () => {
    database = await migrated();
    clock = START;
  });

  const balance = (id: string) =>
    (database.prepare('SELECT balance FROM players WHERE id = ?').get(id) as { balance: number })
      .balance;
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
  const start = (id = AUCTION) =>
    auctions.startAuction('game', { initiatorPlayerId: 'a', lotName: 'Boardwalk' }, id);
  const bid = async (bidder: string, step = 10) => {
    const current = (await auctions.getCurrent('game'))!;
    return auctions.placeBid('game', {
      bidderPlayerId: bidder,
      auctionId: current.id,
      expectedVersion: current.version,
      step,
    });
  };

  describe('rule gate and starting', () => {
    it('rejects every operation when the rule is off', async () => {
      setup(false);
      await expect(start()).rejects.toMatchObject({ code: 'RULE_DISABLED' });
      await expect(
        auctions.placeBid('game', {
          bidderPlayerId: 'a',
          auctionId: AUCTION,
          expectedVersion: 1,
          step: 10,
        }),
      ).rejects.toMatchObject({ code: 'RULE_DISABLED' });
      expect(await auctions.getCurrent('game')).toBeNull();
    });

    it('starts one auction that ends 30 seconds later, and refuses a second', async () => {
      setup(true);
      const { auction } = await start();
      expect(auction).toMatchObject({
        id: AUCTION,
        lotName: 'Boardwalk',
        state: 'ACTIVE',
        currentBid: 0,
        currentBidderId: null,
        version: 1,
        endsAt: new Date(START + 30_000).toISOString(),
      });
      await expect(start(SECOND)).rejects.toMatchObject({ code: 'AUCTION_ALREADY_ACTIVE' });
      expect((await start()).auction.id).toBe(AUCTION); // a replay of the same command
      expect(count('auctions')).toBe(1);
    });

    it('refuses a bankrupt initiator and an unknown one', async () => {
      setup(true);
      database.exec("UPDATE players SET status = 'BANKRUPT' WHERE id = 'a'");
      await expect(start()).rejects.toMatchObject({ code: 'PLAYER_BANKRUPT' });
      await expect(
        auctions.startAuction('game', { initiatorPlayerId: 'zz', lotName: 'x' }, AUCTION),
      ).rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
    });
  });

  describe('bidding', () => {
    beforeEach(async () => {
      setup(true);
      await start();
    });

    it('turns steps into bids and bumps the version', async () => {
      expect((await bid('b', 25)).auction).toMatchObject({
        currentBid: 25,
        currentBidderId: 'b',
        version: 2,
      });
      expect((await bid('c', 50)).auction).toMatchObject({
        currentBid: 75,
        currentBidderId: 'c',
        version: 3,
      });
      expect(steps).toEqual([10, 25, 50, 100]);
    });

    it('rejects a step that is not allowed', async () => {
      await expect(bid('b', 7)).rejects.toMatchObject({ code: 'INVALID_BID_STEP', status: 400 });
    });

    it('rejects the leader bidding again, and a stale version', async () => {
      await bid('b');
      await expect(bid('b')).rejects.toMatchObject({ code: 'AUCTION_ALREADY_LEADING' });
      await expect(
        auctions.placeBid('game', {
          bidderPlayerId: 'c',
          auctionId: AUCTION,
          expectedVersion: 1,
          step: 10,
        }),
      ).rejects.toMatchObject({
        code: 'AUCTION_BID_STALE',
        details: { auction: { id: AUCTION, version: 2, currentBid: 10 } },
      });
      expect(count('auctions')).toBe(1);
    });

    it('lets only one of two simultaneous bids win the compare-and-set', async () => {
      const results = await Promise.allSettled([bid('b'), bid('c')]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await auctions.getCurrent('game'))!.version).toBe(2);
    });

    it('rejects a bid the available cash cannot cover', async () => {
      database.exec("UPDATE players SET balance = 40 WHERE id = 'b'");
      await expect(bid('b', 50)).rejects.toMatchObject({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 40, required: 50 },
      });
      expect((await bid('b', 25)).auction.currentBid).toBe(25);
    });

    it('rejects a bid at or after the end, and an unknown auction', async () => {
      clock = START + 30_000;
      await expect(bid('b')).rejects.toMatchObject({ code: 'AUCTION_CLOSED' });
      await expect(
        auctions.placeBid('game', {
          bidderPlayerId: 'b',
          auctionId: SECOND,
          expectedVersion: 1,
          step: 10,
        }),
      ).rejects.toMatchObject({ code: 'AUCTION_NOT_FOUND', status: 404 });
    });
  });

  describe('the leading bid is reserved', () => {
    beforeEach(async () => {
      setup(true);
      await start();
      await bid('b', 100);
    });

    it('stops every other debit of the leader, and nobody else', async () => {
      await expect(
        banking.createTransaction('game', { type: 'PLAYER_TO_BANK', playerId: 'b', amount: 1401 }),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_AVAILABLE_FUNDS',
        details: { playerId: 'b', available: 1400, required: 1401 },
      });
      await expect(
        banking.createTransaction('game', {
          type: 'PLAYER_TO_PLAYER',
          sourcePlayerId: 'b',
          destinationPlayerId: 'c',
          amount: 1450,
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      await expect(
        banking.createTransaction('game', {
          type: 'PLAYER_TO_ALL',
          payerPlayerId: 'b',
          amountPerPlayer: 701,
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      expect(balance('b')).toBe(1500);
      expect(count('transactions')).toBe(0);

      await banking.createTransaction('game', {
        type: 'PLAYER_TO_BANK',
        playerId: 'b',
        amount: 1400,
      });
      await banking.createTransaction('game', {
        type: 'PLAYER_TO_BANK',
        playerId: 'c',
        amount: 1500,
      });
      expect([balance('b'), balance('c')]).toEqual([100, 0]);
    });

    it('releases the reserve when the leader is outbid', async () => {
      await bid('c', 10);
      await banking.createTransaction('game', {
        type: 'PLAYER_TO_BANK',
        playerId: 'b',
        amount: 1500,
      });
      expect(balance('b')).toBe(0);
    });

    it('limits all-to-player debits of the leader as well', async () => {
      await expect(
        banking.createTransaction('game', {
          type: 'ALL_TO_PLAYER',
          recipientPlayerId: 'a',
          amountPerPlayer: 1450,
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      expect([balance('a'), balance('b'), balance('c')]).toEqual([1500, 1500, 1500]);
    });

    it('counts the reserve when a payment request is created', async () => {
      database.exec("UPDATE games SET payment_mode = 'CONFIRMATION'");
      await expect(
        banking.createTransaction('game', {
          type: 'PLAYER_TO_PLAYER',
          sourcePlayerId: 'b',
          destinationPlayerId: 'c',
          amount: 1450,
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      expect(count('payment_requests')).toBe(0);
    });

    it('checks the reserve again when a payment request is accepted', async () => {
      database.exec(
        `INSERT INTO payment_requests (id, game_id, kind, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at)
         VALUES ('c0000000-0000-4000-8000-000000000001', 'game', 'PAYMENT', 'b', 'c', 'c', 'b', 1450, 'PENDING', '2999-01-01T00:00:00.000Z')`,
      );
      await expect(
        banking.acceptPaymentRequest('game', 'c0000000-0000-4000-8000-000000000001'),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      expect(balance('b')).toBe(1500);
    });

    it('does not stop bankruptcy, which withdraws the bid', async () => {
      await banking.declareBankruptcy('game', { playerId: 'b' });
      expect(await auctions.getCurrent('game')).toMatchObject({
        currentBid: 100,
        currentBidderId: null,
        version: 3,
      });
    });
  });

  describe('settlement', () => {
    beforeEach(async () => {
      setup(true);
      await start();
    });

    it('is not due before the end', async () => {
      await bid('b');
      clock = START + 29_999;
      expect(await auctions.settleDue('game', AUCTION)).toBeNull();
    });

    it('moves the end to 10 seconds after a late bid and keeps an earlier end otherwise', async () => {
      await bid('b');
      expect((await auctions.getCurrent('game'))?.endsAt).toBe(
        new Date(START + 30_000).toISOString(),
      );
      clock = START + 25_000;
      await bid('c');
      expect((await auctions.getCurrent('game'))?.endsAt).toBe(
        new Date(START + 35_000).toISOString(),
      );
      clock = START + 34_999;
      expect(await auctions.settleDue('game', AUCTION)).toBeNull();
      clock = START + 35_000;
      expect((await auctions.settleDue('game', AUCTION))?.auction.state).toBe('SOLD');
    });

    it('sells to the leader exactly once', async () => {
      await bid('b', 50);
      clock = START + 30_000;
      const first = await auctions.settleDue('game', AUCTION);
      expect(first?.auction).toMatchObject({ state: 'SOLD', currentBid: 50, version: 3 });
      expect(first?.transaction).toMatchObject({
        type: 'AUCTION_PAYMENT',
        amount: 50,
        comment: 'Boardwalk',
        participants: [{ playerId: 'b', balanceDelta: -50 }],
      });
      expect(first?.auction.settledTransactionId).toBe(first?.transaction?.id);
      const second = await auctions.settleDue('game', AUCTION);
      expect(second?.auction.state).toBe('SOLD');
      expect(balance('b')).toBe(1450);
      expect(count('transactions')).toBe(1);
      expect((await auctions.getCurrent('game'))?.state).toBe('SOLD');
    });

    it('rolls the whole batch back when the auction moved after it was read', async () => {
      await bid('b', 50);
      const read = (await auctions.getCurrent('game'))!;
      database.exec("UPDATE auctions SET version = version + 1 WHERE id = '" + AUCTION + "'");
      const db = d1(database);
      const players = await new D1PlayerRepository(db).listByGameId('game');
      const plan = planAuctionSettlement({
        game: (await new D1GameRepository(db).getById('game'))!,
        players,
        auction: read,
      });
      if (plan.kind !== 'SOLD') throw new Error('expected a sale');
      await expect(
        new D1BankingOperationRepository(db).persist({
          transactionId: 'f0000000-0000-4000-8000-000000000001',
          transaction: {
            ...plan.result.transaction,
            settlesAuction: { auctionId: AUCTION, expectedVersion: read.version },
          },
          balanceChanges: plan.result.affectedPlayers,
        }),
      ).rejects.toMatchObject({ name: 'DatabaseError' });
      expect(balance('b')).toBe(1500);
      expect(count('transactions')).toBe(0);
      expect((await auctions.getCurrent('game'))?.state).toBe('ACTIVE');
    });

    it('ends without a sale when nobody bid', async () => {
      clock = START + 30_000;
      const result = await auctions.settleDue('game', AUCTION);
      expect(result?.auction).toMatchObject({ state: 'NO_SALE', version: 2 });
      expect(result?.transaction).toBeUndefined();
      expect(count('transactions')).toBe(0);
    });

    it('ends without a sale when the leader went bankrupt', async () => {
      await bid('b', 50);
      await banking.declareBankruptcy('game', { playerId: 'b', creditorPlayerId: 'c' });
      clock = START + 30_000;
      const result = await auctions.settleDue('game', AUCTION);
      expect(result?.auction.state).toBe('NO_SALE');
      expect(balance('c')).toBe(3000);
      expect(count('transactions')).toBe(1); // only the bankruptcy transfer
    });

    it('ends without a sale when the leader somehow cannot pay', async () => {
      await bid('b', 50);
      database.exec("UPDATE players SET balance = 20 WHERE id = 'b'");
      clock = START + 30_000;
      expect((await auctions.settleDue('game', AUCTION))?.auction.state).toBe('NO_SALE');
      expect(balance('b')).toBe(20);
    });

    it('lets a new auction start once the old one is closed, and keeps the result for two minutes', async () => {
      await bid('b');
      clock = START + 30_000;
      await auctions.settleDue('game', AUCTION);
      await start(SECOND);
      expect((await auctions.getCurrent('game'))?.id).toBe(SECOND);
      clock = START + 60_000 + 121_000;
      database.exec("UPDATE auctions SET state = 'NO_SALE' WHERE id = '" + SECOND + "'");
      expect(await auctions.getCurrent('game')).toBeNull();
    });

    it('can reverse the payment like a bank payment without touching the auction', async () => {
      await bid('b', 50);
      clock = START + 30_000;
      const sold = await auctions.settleDue('game', AUCTION);
      await banking.createTransaction('game', {
        type: 'REVERSAL',
        transactionId: sold!.transaction!.id,
      });
      expect(balance('b')).toBe(1500);
      expect((await auctions.getCurrent('game'))?.state).toBe('SOLD');
    });
  });

  it('settles even when a client pre-claimed a guessable transaction id', async () => {
    setup(true);
    await start();
    await bid('b', 50);
    database.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES ('${AUCTION.slice(0, -1)}2', 'game', 'PLAYER_TO_BANK', 1, 1)`,
    );
    clock = START + 30_000;
    expect((await auctions.settleDue('game', AUCTION))?.auction.state).toBe('SOLD');
    expect(balance('b')).toBe(1450);
  });

  it('subtracts pending payment requests in the bid statement itself', async () => {
    setup(true);
    await start();
    database.exec(
      `INSERT INTO payment_requests (id, game_id, kind, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at)
       VALUES ('c0000000-0000-4000-8000-000000000001', 'game', 'PAYMENT', 'b', 'c', 'c', 'b', 1450, 'PENDING', '2999-01-01T00:00:00.000Z')`,
    );
    const repository = new D1AuctionRepository(d1(database));
    const attempt = (bid: number) =>
      repository.placeBid({
        gameId: 'game',
        auctionId: AUCTION,
        expectedVersion: 1,
        bid,
        bidderPlayerId: 'b',
        nowIso: new Date(START).toISOString(),
        minEndsAtIso: new Date(START + 10_000).toISOString(),
      });
    expect(await attempt(100)).toBe(false);
    expect(await attempt(50)).toBe(true);
  });

  it('still deletes and purges a game that has auctions', async () => {
    setup(true);
    await start();
    await bid('b');
    clock = START + 30_000;
    await auctions.settleDue('game', AUCTION);
    expect(await new D1GameRepository(d1(database)).delete('game')).toBe(true);
    expect(count('auctions')).toBe(0);
    expect(count('players')).toBe(0);
  });
});
