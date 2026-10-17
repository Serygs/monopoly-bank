// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { propertyPurchase } from '../../shared/domain/banking.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultAuctionService } from '../services/auction-service.js';
import { DefaultBankingService } from '../services/banking-service.js';
import { D1AuctionRepository } from './auction-repository.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1LoanRepository } from './loan-repository.js';
import { D1MortgageRepository } from './mortgage-repository.js';
import { D1PaymentRequestRepository } from './payment-request-repository.js';
import { D1PlayerRepository } from './player-repository.js';
import { D1PropertyRepository } from './property-repository.js';
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
  // D1 runs a batch as one transaction: either every statement applies or none does.
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

const START = Date.parse('2026-01-01T00:00:00.000Z');
const BALANCE = 15_000_000;
const settings = buildGameSettings(BALANCE, 'monopoly-ru-2012');

describe('board registry (real SQLite)', () => {
  let database: DatabaseSync;
  let clock: number;
  let nextId: number;
  let banking: DefaultBankingService;
  let auctions: DefaultAuctionService;
  let properties: D1PropertyRepository;
  let transactions: D1TransactionRepository;
  let operations: D1BankingOperationRepository;
  let players: D1PlayerRepository;
  let games: D1GameRepository;

  const newId = () => `b0000000-0000-4000-8000-${(nextId++).toString(16).padStart(12, '0')}`;

  /** A game with two players; `board` false makes it a legacy game without a registry. */
  async function setup(board = true): Promise<void> {
    database.exec(
      "INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES ('owner', 'owner', 'x', 'h', 's')",
    );
    const db = d1(database);
    games = new D1GameRepository(db);
    players = new D1PlayerRepository(db);
    transactions = new D1TransactionRepository(db);
    operations = new D1BankingOperationRepository(db);
    properties = new D1PropertyRepository(db);
    await games.createWithPlayers(
      {
        id: 'game',
        name: 'Board',
        startingBalance: BALANCE,
        passGoReward: 2_000_000,
        currency: 'M',
        ownerUserId: 'owner',
        joinCode: 'BOARD',
        gameAccessPasswordHash: null,
        gameAccessPasswordSalt: null,
        rules: { ...defaultGameRules, auctions: true },
        settings: board ? settings : buildGameSettings(BALANCE),
      },
      ['a', 'b'].map((id) => ({
        id,
        gameId: 'game',
        name: id,
        color: `#11111${id === 'a' ? 1 : 2}`,
        balance: BALANCE,
      })),
    );
    database.exec("UPDATE games SET status = 'ACTIVE'");
    const common = {
      games,
      players,
      transactions,
      operations,
      paymentRequests: new D1PaymentRequestRepository(db),
      auctions: new D1AuctionRepository(db),
      properties,
    };
    auctions = new DefaultAuctionService({ ...common, now: () => clock, createId: newId });
    banking = new DefaultBankingService({
      ...common,
      mortgages: new D1MortgageRepository(db),
      loans: new D1LoanRepository(db),
      createId: newId,
    });
  }

  beforeEach(async () => {
    database = await migrated();
    clock = START;
    nextId = 1;
  });

  const balance = (id: string) =>
    (database.prepare('SELECT balance FROM players WHERE id = ?').get(id) as { balance: number })
      .balance;
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
  const tile = (id: string) =>
    database.prepare('SELECT * FROM game_properties WHERE tile_id = ?').get(id) as {
      owner_player_id: string | null;
      mortgaged: number;
    };
  const mortgageState = () =>
    (database.prepare('SELECT state FROM mortgages').get() as { state: string } | undefined)?.state;
  const buy = (playerId = 'a', tileId = 'zhitna', priceOverride?: number) =>
    banking.createTransaction('game', {
      type: 'PROPERTY_PURCHASE',
      playerId,
      tileId,
      ...(priceOverride === undefined ? {} : { priceOverride }),
    });
  const reverse = (transactionId: string) =>
    banking.createTransaction('game', { type: 'REVERSAL', transactionId });

  describe('purchase', () => {
    it('pays the list price and does not flag it', async () => {
      await setup();
      const { transaction } = await buy();
      expect(transaction.amount).toBe(600_000);
      expect(transaction.priceOverridden).toBeUndefined();
      expect(tile('zhitna').owner_player_id).toBe('a');
    });

    it('stores an overridden price and flags the purchase in the ledger', async () => {
      await setup();
      const { transaction } = await buy('a', 'zhitna', 250_000);
      expect(transaction).toMatchObject({ amount: 250_000, priceOverridden: true });
      expect((await transactions.getById('game', transaction.id))?.priceOverridden).toBe(true);
      expect(balance('a')).toBe(BALANCE - 250_000);
    });

    it('refuses a price the buyer cannot pay and writes nothing', async () => {
      await setup();
      await expect(buy('a', 'zhitna', BALANCE + 1)).rejects.toMatchObject({
        code: 'INSUFFICIENT_FUNDS',
      });
      expect(count('transactions')).toBe(0);
      expect(tile('zhitna').owner_player_id).toBeNull();
    });

    it('rejects the override flag on any other transaction type at the database', async () => {
      await setup();
      expect(() =>
        database
          .prepare(
            `INSERT INTO transactions (id, game_id, type, amount, total_amount, price_overridden)
             VALUES ('x', 'game', 'PLAYER_TO_BANK', 1, 1, 1)`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/);
    });

    it('is refused while the tile is being auctioned', async () => {
      await setup();
      await auctions.startAuction('game', { initiatorPlayerId: 'a', tileId: 'zhitna' }, newId());
      await expect(buy('b')).rejects.toMatchObject({ code: 'PROPERTY_IN_AUCTION' });
      expect(count('transactions')).toBe(0);
    });

    it('refuses tile requests in a game without a board', async () => {
      await setup(false);
      await expect(buy()).rejects.toMatchObject({ code: 'BOARD_DISABLED' });
    });

    it('refuses a free-text mortgage in a board game', async () => {
      await setup();
      await expect(
        banking.createTransaction('game', {
          type: 'MORTGAGE',
          playerId: 'a',
          propertyName: 'Zhitna',
          amount: 300_000,
        }),
      ).rejects.toMatchObject({ code: 'TILE_REQUIRED' });
    });
  });

  describe('guarded registry writes', () => {
    it('rolls back balance, transaction and diff when the tile moved since it was read', async () => {
      await setup();
      const players_ = await players.listByGameId('game');
      const stale = propertyPurchase({
        game: (await games.getById('game'))!,
        players: players_,
        playerId: 'a',
        tileId: 'zhitna',
        property: { board: settings.board!, registry: await properties.listByGame('game') },
      });
      database.exec("UPDATE game_properties SET owner_player_id = 'b' WHERE tile_id = 'zhitna'");
      await expect(
        operations.persist({
          transactionId: newId(),
          transaction: stale.transaction,
          balanceChanges: stale.affectedPlayers,
        }),
      ).rejects.toMatchObject({ name: 'DatabaseError' });
      expect(balance('a')).toBe(BALANCE);
      expect(count('transactions')).toBe(0);
      expect(count('property_changes')).toBe(0);
      expect(tile('zhitna').owner_player_id).toBe('b');
    });
  });

  describe('reversing a purchase', () => {
    it('hands the tile back and the money returns', async () => {
      await setup();
      const { transaction } = await buy();
      await reverse(transaction.id);
      expect(tile('zhitna').owner_player_id).toBeNull();
      expect(balance('a')).toBe(BALANCE);
    });

    it('is refused with PROPERTY_CHANGED when the tile is no longer as the purchase left it', async () => {
      await setup();
      const { transaction } = await buy();
      database.exec("UPDATE game_properties SET owner_player_id = 'b' WHERE tile_id = 'zhitna'");
      await expect(reverse(transaction.id)).rejects.toMatchObject({ code: 'PROPERTY_CHANGED' });
      expect(count('transactions')).toBe(1);
    });

    it('is blocked by rent paid on another tile of the same colour group', async () => {
      await setup();
      await buy('a', 'nagatinska');
      const completing = await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'PAY_RENT',
        payerPlayerId: 'b',
        tileId: 'nagatinska',
      });
      await expect(reverse(completing.transaction.id)).rejects.toMatchObject({
        code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      });
      expect(tile('zhitna').owner_player_id).toBe('a');
    });
  });

  describe('reversing a board mortgage', () => {
    const mortgage = () =>
      banking.createTransaction('game', { type: 'MORTGAGE', playerId: 'a', tileId: 'zhitna' });
    const redeem = () =>
      banking.createTransaction('game', {
        type: 'MORTGAGE_REDEMPTION',
        playerId: 'a',
        mortgageId: (
          database.prepare("SELECT id FROM mortgages WHERE state = 'ACTIVE'").get() as {
            id: string;
          }
        ).id,
      });

    it('takes back the money, unmortgages the tile and releases the mortgage row', async () => {
      await setup();
      await buy();
      const { transaction } = await mortgage();
      expect(tile('zhitna').mortgaged).toBe(1);
      const response = await reverse(transaction.id);
      expect(tile('zhitna')).toMatchObject({ owner_player_id: 'a', mortgaged: 0 });
      expect(mortgageState()).toBe('RELEASED');
      expect(balance('a')).toBe(BALANCE - 600_000);
      expect(response).toHaveProperty('mortgages', []);
      // The tile can be mortgaged again afterwards.
      await mortgage();
      expect(tile('zhitna').mortgaged).toBe(1);
    });

    it('restores the mortgage when a redemption is reversed', async () => {
      await setup();
      await buy();
      await mortgage();
      const redemption = await redeem();
      expect(mortgageState()).toBe('REDEEMED');
      await reverse(redemption.transaction.id);
      expect(tile('zhitna').mortgaged).toBe(1);
      expect(mortgageState()).toBe('ACTIVE');
      expect(
        database.prepare('SELECT redeemed_by_transaction_id AS r FROM mortgages').get(),
      ).toEqual({ r: null });
      // And it can be redeemed again.
      await redeem();
      expect(mortgageState()).toBe('REDEEMED');
    });

    it('refuses to reverse a mortgage that was already redeemed', async () => {
      await setup();
      await buy();
      const { transaction } = await mortgage();
      await redeem();
      await expect(reverse(transaction.id)).rejects.toMatchObject({
        code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      });
      expect(mortgageState()).toBe('REDEEMED');
    });

    it('rolls the whole reversal back when the mortgage row is no longer in step', async () => {
      await setup();
      await buy();
      const { transaction } = await mortgage();
      database.exec("UPDATE mortgages SET state = 'RELEASED'");
      await expect(reverse(transaction.id)).rejects.toMatchObject({ name: 'DatabaseError' });
      expect(tile('zhitna').mortgaged).toBe(1);
      expect(count('transactions')).toBe(2);
    });
  });

  describe('tile auctions', () => {
    const start = (tileId = 'zhitna') =>
      auctions.startAuction('game', { initiatorPlayerId: 'a', tileId }, newId());

    it('refuses to start on a tile somebody owns', async () => {
      await setup();
      await buy('a');
      await expect(start()).rejects.toMatchObject({ code: 'PROPERTY_ALREADY_OWNED' });
      expect(count('auctions')).toBe(0);
    });

    it('ends without a sale when nobody bids and leaves the tile unowned', async () => {
      await setup();
      const { auction } = await start();
      clock = START + 30_000;
      const result = await auctions.settleDue('game', auction.id);
      expect(result?.auction.state).toBe('NO_SALE');
      expect(tile('zhitna').owner_player_id).toBeNull();
      expect(count('transactions')).toBe(0);
    });

    it('sells the tile as a PROPERTY_PURCHASE at the winning bid and can be reversed', async () => {
      await setup();
      const { auction } = await start();
      await auctions.placeBid('game', {
        bidderPlayerId: 'b',
        auctionId: auction.id,
        expectedVersion: auction.version,
        step: auction.currentBid === 0 ? settings.auctionBidSteps[0]! : 0,
      });
      clock = START + 60_000;
      const sold = await auctions.settleDue('game', auction.id);
      expect(sold?.transaction).toMatchObject({ type: 'PROPERTY_PURCHASE', tileId: 'zhitna' });
      expect(sold?.transaction?.priceOverridden).toBeUndefined();
      expect(tile('zhitna').owner_player_id).toBe('b');
      await reverse(sold!.transaction!.id);
      expect(tile('zhitna').owner_player_id).toBeNull();
      expect(balance('b')).toBe(BALANCE);
    });
  });
});
