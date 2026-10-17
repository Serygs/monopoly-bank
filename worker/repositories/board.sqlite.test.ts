// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildProperty,
  declareBankruptcy,
  propertyPurchase,
  transferProperties,
} from '../../shared/domain/banking.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultAuctionService } from '../services/auction-service.js';
import { DefaultBankingService } from '../services/banking-service.js';
import { D1AuctionRepository } from './auction-repository.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';
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

  describe('building', () => {
    const houses = (id: string) =>
      (
        database.prepare('SELECT houses FROM game_properties WHERE tile_id = ?').get(id) as {
          houses: number;
        }
      ).houses;
    const buildOn = (
      tileId: string,
      type: 'PROPERTY_BUILD' | 'PROPERTY_SELL_BUILDING' = 'PROPERTY_BUILD',
    ) => banking.createTransaction('game', { type, playerId: 'a', tileId });
    const ownBrown = async () => {
      await buy('a', 'zhitna');
      await buy('a', 'nagatinska');
    };

    it('builds, pays the bank, stores the diff and returns the changed row', async () => {
      await setup();
      await ownBrown();
      const before = balance('a');
      const response = await buildOn('zhitna');
      expect(response.transaction).toMatchObject({ type: 'PROPERTY_BUILD', amount: 500_000 });
      expect(houses('zhitna')).toBe(1);
      expect(balance('a')).toBe(before - 500_000);
      expect(response.properties).toEqual([
        expect.objectContaining({ tileId: 'zhitna', houses: 1 }),
      ]);
      expect(count('property_changes')).toBe(3);
    });

    it('refuses an uneven build and a build without the full group, writing nothing', async () => {
      await setup();
      await buy('a', 'zhitna');
      await expect(buildOn('zhitna')).rejects.toMatchObject({ code: 'BUILD_REQUIRES_FULL_GROUP' });
      await buy('a', 'nagatinska');
      await buildOn('zhitna');
      const transactions_ = count('transactions');
      await expect(buildOn('zhitna')).rejects.toMatchObject({ code: 'BUILD_UNEVEN' });
      expect(count('transactions')).toBe(transactions_);
      expect(houses('zhitna')).toBe(1);
    });

    it('refuses to build without the money and writes nothing', async () => {
      await setup();
      await ownBrown();
      database.exec("UPDATE players SET balance = 100 WHERE id = 'a'");
      await expect(buildOn('zhitna')).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      expect(houses('zhitna')).toBe(0);
      expect(balance('a')).toBe(100);
    });

    it('cannot mortgage a group with buildings, then sells back at half price', async () => {
      await setup();
      await ownBrown();
      await buildOn('zhitna');
      await expect(
        banking.createTransaction('game', {
          type: 'MORTGAGE',
          playerId: 'a',
          tileId: 'nagatinska',
        }),
      ).rejects.toMatchObject({ code: 'PROPERTY_HAS_BUILDINGS' });
      const before = balance('a');
      await buildOn('zhitna', 'PROPERTY_SELL_BUILDING');
      expect(houses('zhitna')).toBe(0);
      expect(balance('a')).toBe(before + 250_000);
      await expect(buildOn('zhitna', 'PROPERTY_SELL_BUILDING')).rejects.toMatchObject({
        code: 'NO_BUILDINGS',
      });
    });

    it('reverses a build and a sale; a later build on the group blocks the earlier one', async () => {
      await setup();
      await ownBrown();
      const first = await buildOn('zhitna');
      const second = await buildOn('nagatinska');
      await expect(reverse(first.transaction.id)).rejects.toMatchObject({
        code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      });
      await reverse(second.transaction.id);
      expect(houses('nagatinska')).toBe(0);
      await reverse(first.transaction.id);
      expect(houses('zhitna')).toBe(0);
      expect(balance('a')).toBe(BALANCE - 1_200_000);
    });

    it('reverses a sale: the building returns and the refund is taken back', async () => {
      await setup();
      await ownBrown();
      await buildOn('zhitna');
      const sold = await buildOn('zhitna', 'PROPERTY_SELL_BUILDING');
      await reverse(sold.transaction.id);
      expect(houses('zhitna')).toBe(1);
    });

    describe('several streets at once', () => {
      const buildTo = (targets: Record<string, number>, type = 'PROPERTY_BUILD' as const) =>
        banking.createTransaction('game', { type, playerId: 'a', targets });
      const diffCount = () => count('property_changes');

      it('builds the group in one operation, one diff per street, and reverses it as a unit', async () => {
        await setup();
        await ownBrown();
        const before = balance('a');
        const diffsBefore = diffCount();
        const txBefore = count('transactions');
        const response = await buildTo({ zhitna: 2, nagatinska: 1 });
        expect(response.transaction).toMatchObject({ type: 'PROPERTY_BUILD', amount: 1_500_000 });
        expect(houses('zhitna')).toBe(2);
        expect(houses('nagatinska')).toBe(1);
        expect(balance('a')).toBe(before - 1_500_000);
        expect(count('transactions')).toBe(txBefore + 1);
        expect(diffCount()).toBe(diffsBefore + 2);
        expect(response.properties).toHaveLength(2);

        const stored = await banking.getTransaction('game', response.transaction.id);
        expect(stored?.tileIds?.slice().sort()).toEqual(['nagatinska', 'zhitna']);

        await reverse(response.transaction.id);
        expect(houses('zhitna')).toBe(0);
        expect(houses('nagatinska')).toBe(0);
        expect(balance('a')).toBe(before);
      });

      it('refuses an uneven or short plan and writes nothing', async () => {
        await setup();
        await ownBrown();
        const txBefore = count('transactions');
        await expect(buildTo({ zhitna: 2 })).rejects.toMatchObject({ code: 'BUILD_UNEVEN' });
        database.exec("UPDATE players SET balance = 400000 WHERE id = 'a'");
        await expect(buildTo({ zhitna: 1, nagatinska: 1 })).rejects.toMatchObject({
          code: 'INSUFFICIENT_FUNDS',
        });
        expect(houses('zhitna')).toBe(0);
        expect(houses('nagatinska')).toBe(0);
        expect(balance('a')).toBe(400_000);
        expect(count('transactions')).toBe(txBefore);
      });

      it('refuses a group with a mortgaged tile', async () => {
        await setup();
        await ownBrown();
        await banking.createTransaction('game', {
          type: 'MORTGAGE',
          playerId: 'a',
          tileId: 'nagatinska',
        });
        await expect(buildTo({ zhitna: 1 })).rejects.toMatchObject({
          code: 'BUILD_MORTGAGED_GROUP',
        });
        expect(houses('zhitna')).toBe(0);
      });

      it('rolls everything back when a street moved between reading and writing', async () => {
        await setup();
        await ownBrown();
        const game_ = (await games.getById('game'))!;
        const stale = buildProperty({
          game: game_,
          players: await players.listByGameId('game'),
          playerId: 'a',
          targets: { zhitna: 1, nagatinska: 1 },
          property: { board: settings.board!, registry: await properties.listByGame('game') },
        });
        // Another operation builds on one street first.
        database.exec("UPDATE game_properties SET houses = 1 WHERE tile_id = 'zhitna'");
        const txBefore = count('transactions');
        const cash = balance('a');
        await expect(
          operations.persist({
            transactionId: newId(),
            transaction: stale.transaction,
            balanceChanges: stale.affectedPlayers,
          }),
        ).rejects.toMatchObject({ name: 'DatabaseError' });
        expect(count('transactions')).toBe(txBefore);
        expect(balance('a')).toBe(cash);
        expect(houses('nagatinska')).toBe(0);
      });

      it('sells several buildings and reverses the sale as a unit', async () => {
        await setup();
        await ownBrown();
        await buildTo({ zhitna: 2, nagatinska: 2 });
        const before = balance('a');
        const sold = await buildTo({ zhitna: 1, nagatinska: 1 }, 'PROPERTY_SELL_BUILDING');
        expect(balance('a')).toBe(before + 500_000);
        expect(houses('zhitna')).toBe(1);
        await reverse(sold.transaction.id);
        expect(houses('zhitna')).toBe(2);
        expect(houses('nagatinska')).toBe(2);
        expect(balance('a')).toBe(before);
      });
    });

    it('blocks reversing the purchase that completed a group once a house stands', async () => {
      await setup();
      await buy('a', 'zhitna');
      const completing = await buy('a', 'nagatinska');
      await buildOn('zhitna');
      await expect(reverse(completing.transaction.id)).rejects.toMatchObject({
        code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      });
    });

    it('is refused in a game without a board', async () => {
      await setup(false);
      await expect(buildOn('zhitna')).rejects.toMatchObject({ code: 'BOARD_DISABLED' });
    });
  });

  describe('trading', () => {
    const owner = (id: string) =>
      (
        database
          .prepare('SELECT owner_player_id AS o FROM game_properties WHERE tile_id = ?')
          .get(id) as { o: string | null }
      ).o;
    const trade = (
      body: {
        giveTileIds: string[];
        takeTileIds: string[];
        cashGive?: number;
        cashTake?: number;
      },
      playerId = 'a',
      counterpartyPlayerId = 'b',
    ) =>
      banking.executeTradeTransfer('game', {
        type: 'PROPERTY_TRANSFER',
        playerId,
        counterpartyPlayerId,
        ...body,
      });
    const mortgageOwner = () =>
      (
        database.prepare("SELECT player_id AS p FROM mortgages WHERE state = 'ACTIVE'").get() as
          { p: string } | undefined
      )?.p;

    it('swaps two tiles for no money and lists the trade for both traders', async () => {
      await setup();
      await buy('a', 'zhitna');
      await buy('b', 'riga_rail');
      const { transaction } = await trade({ giveTileIds: ['zhitna'], takeTileIds: ['riga_rail'] });
      expect(transaction).toMatchObject({
        type: 'PROPERTY_TRANSFER',
        amount: 0,
        initiatorPlayerId: 'a',
        tileIds: expect.arrayContaining(['zhitna', 'riga_rail']),
      });
      expect(owner('zhitna')).toBe('b');
      expect(owner('riga_rail')).toBe('a');
      for (const playerId of ['a', 'b'])
        expect(
          (await transactions.listByPlayerId('game', playerId)).map((item) => item.id),
        ).toContain(transaction.id);
    });

    it('gifts a tile with cash in both directions netted into one amount', async () => {
      await setup();
      await buy('a', 'zhitna');
      const before = balance('a');
      const { transaction } = await trade({
        giveTileIds: ['zhitna'],
        takeTileIds: [],
        cashTake: 700_000,
        cashGive: 100_000,
      });
      expect(transaction.amount).toBe(600_000);
      expect(balance('a')).toBe(before + 600_000);
      expect(balance('b')).toBe(BALANCE - 600_000);
      expect(owner('zhitna')).toBe('b');
    });

    it('moves the mortgage with the tile, charges the receiver 10% and lets them redeem it', async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      const before = balance('b');
      const response = await trade({ giveTileIds: ['zhitna'], takeTileIds: [] });
      expect(balance('b')).toBe(before - 30_000);
      expect(mortgageOwner()).toBe('b');
      expect(tile('zhitna').mortgaged).toBe(1);
      expect(response.mortgages?.map((item) => item.playerId)).toEqual(['b']);
      // The receiver, not the old owner, can redeem it (value + 10%).
      const mortgageId = (
        database.prepare("SELECT id FROM mortgages WHERE state = 'ACTIVE'").get() as {
          id: string;
        }
      ).id;
      await expect(
        banking.createTransaction('game', {
          type: 'MORTGAGE_REDEMPTION',
          playerId: 'a',
          mortgageId,
        }),
      ).rejects.toMatchObject({ code: 'MORTGAGE_NOT_FOUND' });
      await banking.createTransaction('game', {
        type: 'MORTGAGE_REDEMPTION',
        playerId: 'b',
        mortgageId,
      });
      expect(tile('zhitna').mortgaged).toBe(0);
    });

    it('refuses a receiver who cannot pay the fee and writes nothing', async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      database.exec("UPDATE players SET balance = 10 WHERE id = 'b'");
      const count_ = count('transactions');
      await expect(trade({ giveTileIds: ['zhitna'], takeTileIds: [] })).rejects.toMatchObject({
        code: 'INSUFFICIENT_FUNDS',
      });
      expect(count('transactions')).toBe(count_);
      expect(owner('zhitna')).toBe('a');
      expect(mortgageOwner()).toBe('a');
    });

    it("refuses tiles of a built-on colour group and tiles that are not the trader's", async () => {
      await setup();
      await buy('a', 'zhitna');
      await buy('a', 'nagatinska');
      await banking.createTransaction('game', {
        type: 'PROPERTY_BUILD',
        playerId: 'a',
        tileId: 'zhitna',
      });
      await expect(trade({ giveTileIds: ['nagatinska'], takeTileIds: [] })).rejects.toMatchObject({
        code: 'PROPERTY_HAS_BUILDINGS',
      });
      await expect(trade({ giveTileIds: ['riga_rail'], takeTileIds: [] })).rejects.toMatchObject({
        code: 'PROPERTY_NOT_OWNED',
      });
    });

    it('rolls everything back when a tile moved between reading and writing', async () => {
      await setup();
      await buy('a', 'zhitna');
      const game_ = (await games.getById('game'))!;
      const stale = transferProperties({
        game: game_,
        players: await players.listByGameId('game'),
        playerId: 'a',
        counterpartyPlayerId: 'b',
        giveTileIds: ['zhitna'],
        takeTileIds: [],
        cashGive: 0,
        cashTake: 100_000,
        property: { board: settings.board!, registry: await properties.listByGame('game') },
      });
      database.exec("UPDATE game_properties SET owner_player_id = 'b' WHERE tile_id = 'zhitna'");
      const count_ = count('transactions');
      await expect(
        operations.persist({
          transactionId: newId(),
          transaction: stale.transaction,
          balanceChanges: stale.affectedPlayers,
        }),
      ).rejects.toMatchObject({ name: 'DatabaseError' });
      expect(count('transactions')).toBe(count_);
      expect(balance('b')).toBe(BALANCE);
    });

    it('is reversed by the trader: tiles, mortgage and money all return', async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      const balanceA = balance('a');
      const balanceB = balance('b');
      const { transaction } = await trade({
        giveTileIds: ['zhitna'],
        takeTileIds: [],
        cashTake: 100_000,
      });
      await reverse(transaction.id);
      expect(owner('zhitna')).toBe('a');
      expect(mortgageOwner()).toBe('a');
      expect(balance('a')).toBe(balanceA);
      expect(balance('b')).toBe(balanceB);
    });

    it('reverses a zero-money swap even though no money moved', async () => {
      await setup();
      await buy('a', 'zhitna');
      await buy('b', 'riga_rail');
      const { transaction } = await trade({ giveTileIds: ['zhitna'], takeTileIds: ['riga_rail'] });
      await reverse(transaction.id);
      expect(owner('zhitna')).toBe('a');
      expect(owner('riga_rail')).toBe('b');
    });

    it('is blocked from reversal by a later operation on a traded tile', async () => {
      await setup();
      await buy('a', 'zhitna');
      await buy('b', 'riga_rail');
      const { transaction } = await trade({ giveTileIds: ['zhitna'], takeTileIds: ['riga_rail'] });
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'b',
        tileId: 'zhitna',
      });
      await expect(reverse(transaction.id)).rejects.toMatchObject({
        code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      });
      expect(owner('zhitna')).toBe('b');
    });

    it('is refused in a game without a board', async () => {
      await setup(false);
      await expect(trade({ giveTileIds: ['zhitna'], takeTileIds: [] })).rejects.toMatchObject({
        code: 'BOARD_DISABLED',
      });
    });

    it('leaves a zero-money trade out of the money statistics', async () => {
      await setup();
      await buy('a', 'zhitna');
      await trade({ giveTileIds: ['zhitna'], takeTileIds: [] });
      const stats = await new D1GameStatisticsRepository(d1(database)).calculate(
        (await games.getById('game'))!,
        await players.listByGameId('game'),
      );
      // Only the purchase moved money; the trade counts as an operation but adds nothing.
      expect(stats.totalMoneyTransferred).toBe(600_000);
      expect(stats.largestTransaction).toBe(600_000);
      expect(stats.totalTransactions).toBe(2);
      expect(stats.awards.biggestOperation?.type).toBe('PROPERTY_PURCHASE');
    });
  });

  describe('bankruptcy with assets', () => {
    const houses = (id: string) =>
      (
        database.prepare('SELECT houses FROM game_properties WHERE tile_id = ?').get(id) as {
          houses: number;
        }
      ).houses;
    const owner = (id: string) => tile(id).owner_player_id;
    const bankrupt = (creditorPlayerId?: string) =>
      banking.declareBankruptcy('game', {
        playerId: 'a',
        ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
      });
    const status = (id: string) =>
      (database.prepare('SELECT status FROM players WHERE id = ?').get(id) as { status: string })
        .status;
    const mortgageRows = () =>
      database.prepare('SELECT player_id AS p, state FROM mortgages ORDER BY id').all();
    const builtBrown = async () => {
      await buy('a', 'zhitna');
      await buy('a', 'nagatinska');
      for (const tileId of ['zhitna', 'nagatinska', 'zhitna'])
        await banking.createTransaction('game', {
          type: 'PROPERTY_BUILD',
          playerId: 'a',
          tileId,
        });
    };

    it('sells the buildings first, so the creditor gets cash plus the proceeds, and records one diff per tile', async () => {
      await setup();
      await builtBrown();
      const cash = balance('a');
      const before = balance('b');
      const response = await bankrupt('b');
      // Three buildings (2 + 1) at 250_000 each.
      expect(balance('b')).toBe(before + cash + 750_000);
      expect(response.transaction).toMatchObject({ amount: cash + 750_000 });
      expect(houses('zhitna')).toBe(0);
      expect(houses('nagatinska')).toBe(0);
      expect(owner('zhitna')).toBe('b');
      expect(owner('nagatinska')).toBe('b');
      expect(status('a')).toBe('BANKRUPT');
      const diffs = database
        .prepare(
          'SELECT tile_id, before_houses AS bh, after_houses AS ah FROM property_changes WHERE transaction_id = ? ORDER BY tile_id',
        )
        .all(response.transaction.id);
      expect(diffs).toEqual([
        { tile_id: 'nagatinska', bh: 1, ah: 0 },
        { tile_id: 'zhitna', bh: 2, ah: 0 },
      ]);
      expect(response.properties?.map((row) => row.tileId).sort()).toContain('zhitna');
    });

    it('charges the creditor the mortgage fee and hands them the mortgage', async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      const cash = balance('a');
      const before = balance('b');
      await bankrupt('b');
      expect(balance('b')).toBe(before + cash - 30_000);
      expect(tile('zhitna').mortgaged).toBe(1);
      expect(mortgageRows()).toEqual([{ p: 'b', state: 'ACTIVE' }]);
    });

    it('refuses with BANKRUPTCY_CREDITOR_SHORT, writes nothing, and works once the creditor has cash', async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      database.exec("UPDATE players SET balance = 0 WHERE id = 'a'");
      database.exec("UPDATE players SET balance = 10000 WHERE id = 'b'");
      const written = count('transactions');
      await expect(bankrupt('b')).rejects.toMatchObject({
        code: 'BANKRUPTCY_CREDITOR_SHORT',
        details: { creditorPlayerId: 'b', required: 30_000, shortfall: 20_000 },
      });
      expect(count('transactions')).toBe(written);
      expect(status('a')).toBe('ACTIVE');
      expect(owner('zhitna')).toBe('a');
      database.exec("UPDATE players SET balance = 30000 WHERE id = 'b'");
      await bankrupt('b');
      expect(status('a')).toBe('BANKRUPT');
      expect(balance('b')).toBe(0);
      expect(owner('zhitna')).toBe('b');
    });

    it('returns everything to the bank, unbuilt, unmortgaged and with the mortgage released', async () => {
      await setup();
      await builtBrown();
      await buy('a', 'riga_rail');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'riga_rail',
      });
      const before = balance('b');
      await bankrupt();
      expect(balance('b')).toBe(before);
      for (const tileId of ['zhitna', 'nagatinska', 'riga_rail']) {
        expect(owner(tileId)).toBeNull();
        expect(tile(tileId).mortgaged).toBe(0);
        expect(houses(tileId)).toBe(0);
      }
      expect(mortgageRows()).toEqual([{ p: 'a', state: 'RELEASED' }]);
    });

    it("keeps the creditor's leading auction bid covered when the fees would eat into it", async () => {
      await setup();
      await buy('a', 'zhitna');
      await banking.createTransaction('game', {
        type: 'MORTGAGE',
        playerId: 'a',
        tileId: 'zhitna',
      });
      const { auction } = await auctions.startAuction(
        'game',
        { initiatorPlayerId: 'a', tileId: 'riga_rail' },
        newId(),
      );
      const step = settings.auctionBidSteps[0]!;
      await auctions.placeBid('game', {
        bidderPlayerId: 'b',
        auctionId: auction.id,
        expectedVersion: auction.version,
        step,
      });
      database.exec("UPDATE players SET balance = 0 WHERE id = 'a'");
      database.exec(`UPDATE players SET balance = ${step + 10_000} WHERE id = 'b'`);
      await expect(bankrupt('b')).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABLE_FUNDS' });
      expect(status('a')).toBe('ACTIVE');
    });

    it('rolls everything back when a tile moved between reading and writing', async () => {
      await setup();
      await builtBrown();
      const result = declareBankruptcy({
        game: (await games.getById('game'))!,
        players: await players.listByGameId('game'),
        playerId: 'a',
        creditorPlayerId: 'b',
        property: { board: settings.board!, registry: await properties.listByGame('game') },
      });
      database.exec("UPDATE game_properties SET houses = 0 WHERE tile_id = 'zhitna'");
      const written = count('transactions');
      await expect(
        operations.persist({
          transactionId: newId(),
          transaction: result.transaction,
          balanceChanges: result.affectedPlayers,
          bankruptPlayerId: 'a',
          mortgageHeirPlayerId: 'b',
          loanHeirPlayerId: 'b',
        }),
      ).rejects.toMatchObject({ name: 'DatabaseError' });
      expect(count('transactions')).toBe(written);
      expect(status('a')).toBe('ACTIVE');
      expect(owner('nagatinska')).toBe('a');
    });
  });
});
