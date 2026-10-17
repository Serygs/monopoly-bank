// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateTradeRequestBody } from '../../shared/contracts/api.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from '../services/banking-service.js';
import { D1AuctionRepository } from './auction-repository.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1LoanRepository } from './loan-repository.js';
import { D1MortgageRepository } from './mortgage-repository.js';
import { D1PaymentRequestRepository } from './payment-request-repository.js';
import { D1PlayerRepository } from './player-repository.js';
import { D1PropertyRepository } from './property-repository.js';
import { D1TradeRequestRepository } from './trade-request-repository.js';
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

const BALANCE = 15_000_000;
const settings = buildGameSettings(BALANCE, 'monopoly-ru-2012');
const REQUEST = 'c0000000-0000-4000-8000-000000000001';

describe('trade requests (real SQLite)', () => {
  let database: DatabaseSync;
  let banking: DefaultBankingService;
  let tradeRequests: D1TradeRequestRepository;
  let operations: D1BankingOperationRepository;
  let nextId: number;
  const newId = () => `b0000000-0000-4000-8000-${(nextId++).toString(16).padStart(12, '0')}`;

  async function setup(board = true): Promise<void> {
    database.exec(
      "INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES ('owner', 'owner', 'x', 'h', 's')",
    );
    const db = d1(database);
    const games = new D1GameRepository(db);
    operations = new D1BankingOperationRepository(db);
    tradeRequests = new D1TradeRequestRepository(db);
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
        rules: defaultGameRules,
        settings: board ? settings : buildGameSettings(BALANCE),
      },
      ['a', 'b', 'c'].map((id, index) => ({
        id,
        gameId: 'game',
        name: id,
        color: `#11111${index + 1}`,
        balance: BALANCE,
      })),
    );
    database.exec("UPDATE games SET status = 'ACTIVE'");
    banking = new DefaultBankingService({
      games,
      players: new D1PlayerRepository(db),
      transactions: new D1TransactionRepository(db),
      operations,
      paymentRequests: new D1PaymentRequestRepository(db),
      tradeRequests,
      mortgages: new D1MortgageRepository(db),
      loans: new D1LoanRepository(db),
      auctions: new D1AuctionRepository(db),
      properties: new D1PropertyRepository(db),
      createId: newId,
    });
  }

  beforeEach(async () => {
    database = await migrated();
    nextId = 1;
  });

  const balance = (id: string) =>
    (database.prepare('SELECT balance FROM players WHERE id = ?').get(id) as { balance: number })
      .balance;
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
  const owner = (tileId: string) =>
    (
      database
        .prepare('SELECT owner_player_id AS o FROM game_properties WHERE tile_id = ?')
        .get(tileId) as { o: string | null }
    ).o;
  const stateOf = (id = REQUEST) =>
    (database.prepare('SELECT state FROM trade_requests WHERE id = ?').get(id) as { state: string })
      .state;
  const buy = (playerId: string, tileId: string) =>
    banking.createTransaction('game', { type: 'PROPERTY_PURCHASE', playerId, tileId });
  const propose = (extra: Partial<CreateTradeRequestBody> = {}) =>
    banking.createTradeRequest('game', {
      id: REQUEST,
      playerId: 'a',
      counterpartyPlayerId: 'b',
      giveTileIds: ['zhitna'],
      takeTileIds: ['riga_rail'],
      ...extra,
    });
  /** Both traders own a tile and a proposal is pending; returns the baseline counts. */
  async function proposed(extra: Partial<CreateTradeRequestBody> = {}) {
    await setup();
    await buy('a', 'zhitna');
    await buy('b', 'riga_rail');
    await propose(extra);
    return { transactions: count('transactions'), a: balance('a'), b: balance('b') };
  }

  it('records the proposal without touching the ledger, balances or registry', async () => {
    const before = await proposed();
    expect(stateOf()).toBe('PENDING');
    expect(count('transactions')).toBe(before.transactions);
    expect([balance('a'), balance('b')]).toEqual([before.a, before.b]);
    expect([owner('zhitna'), owner('riga_rail')]).toEqual(['a', 'b']);
    expect(await banking.listTradeRequests('game', ['b'])).toHaveLength(1);
    expect(await banking.listTradeRequests('game', ['a'])).toHaveLength(1);
    expect(await banking.listTradeRequests('game', ['c'])).toEqual([]);
  });

  it('creates idempotently by id', async () => {
    await proposed();
    const again = await propose();
    expect(again.tradeRequest.id).toBe(REQUEST);
    expect(count('trade_requests')).toBe(1);
    await expect(propose({ playerId: 'c' })).rejects.toMatchObject({
      code: 'TRADE_REQUEST_EXISTS',
    });
  });

  it('refuses a proposal that could not be accepted, with a clear code and no row', async () => {
    await setup();
    await buy('a', 'zhitna');
    await buy('b', 'riga_rail');
    await expect(propose({ giveTileIds: ['arbat'] })).rejects.toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
    });
    await expect(propose({ takeTileIds: ['zhitna'], giveTileIds: [] })).rejects.toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
    });
    await expect(propose({ cashGive: BALANCE + 1 })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(count('trade_requests')).toBe(0);
  });

  it('is refused in a game without a board', async () => {
    await setup(false);
    await expect(propose()).rejects.toMatchObject({ code: 'BOARD_DISABLED' });
    expect(count('trade_requests')).toBe(0);
  });

  it('refuses a direct PROPERTY_TRANSFER through the public transaction path', async () => {
    await proposed();
    await expect(
      banking.createTransaction('game', {
        type: 'PROPERTY_TRANSFER',
        playerId: 'a',
        counterpartyPlayerId: 'b',
        giveTileIds: ['zhitna'],
        takeTileIds: [],
      }),
    ).rejects.toMatchObject({ code: 'TRADE_REQUEST_REQUIRED' });
    expect(owner('zhitna')).toBe('a');
  });

  it('accepting writes one PROPERTY_TRANSFER with its registry diffs and marks the request', async () => {
    const before = await proposed({ cashGive: 100_000, cashTake: 0 });
    const response = await banking.acceptTradeRequest('game', REQUEST);
    expect(response.tradeRequest).toMatchObject({
      state: 'ACCEPTED',
      transactionId: response.transaction?.id,
    });
    expect(response.transaction).toMatchObject({
      type: 'PROPERTY_TRANSFER',
      amount: 100_000,
      initiatorPlayerId: 'a',
    });
    expect(count('transactions')).toBe(before.transactions + 1);
    expect([owner('zhitna'), owner('riga_rail')]).toEqual(['b', 'a']);
    expect([balance('a'), balance('b')]).toEqual([before.a - 100_000, before.b + 100_000]);
    expect(response.properties?.map((row) => row.tileId).sort()).toEqual(['riga_rail', 'zhitna']);
    expect(await banking.listTradeRequests('game', ['a', 'b'])).toEqual([]);
  });

  it('accepting twice settles once and returns the same transaction', async () => {
    const before = await proposed();
    const first = await banking.acceptTradeRequest('game', REQUEST);
    const second = await banking.acceptTradeRequest('game', REQUEST);
    expect(second.transaction?.id).toBe(first.transaction?.id);
    expect(count('transactions')).toBe(before.transactions + 1);
  });

  it('an accepted trade is reversible as a unit', async () => {
    await proposed();
    const { transaction } = await banking.acceptTradeRequest('game', REQUEST);
    await banking.createTransaction('game', { type: 'REVERSAL', transactionId: transaction!.id });
    expect([owner('zhitna'), owner('riga_rail')]).toEqual(['a', 'b']);
  });

  it('refuses a stale trade when a traded tile moved, leaving the request pending and nothing written', async () => {
    const before = await proposed();
    // The counterparty gave the tile to somebody else after the proposal.
    await banking.executeTradeTransfer('game', {
      type: 'PROPERTY_TRANSFER',
      playerId: 'b',
      counterpartyPlayerId: 'c',
      giveTileIds: ['riga_rail'],
      takeTileIds: [],
    });
    const afterMove = count('transactions');
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_STALE',
      details: { reason: 'PROPERTY_NOT_OWNED' },
    });
    expect(stateOf()).toBe('PENDING');
    expect(count('transactions')).toBe(afterMove);
    expect(owner('zhitna')).toBe('a');
    expect(balance('a')).toBe(before.a);
  });

  it('refuses when the money is gone by accept time and changes nothing', async () => {
    const before = await proposed({ cashGive: 1_000_000 });
    database.exec("UPDATE players SET balance = 10 WHERE id = 'a'");
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(stateOf()).toBe('PENDING');
    expect(count('transactions')).toBe(before.transactions);
    expect(balance('a')).toBe(10);
    expect(balance('b')).toBe(before.b);
    expect([owner('zhitna'), owner('riga_rail')]).toEqual(['a', 'b']);
  });

  it('declining and cancelling resolve a pending request once; later accepts are refused', async () => {
    await proposed();
    await expect(banking.declineTradeRequest('game', REQUEST)).resolves.toMatchObject({
      tradeRequest: { state: 'DECLINED' },
    });
    await expect(banking.declineTradeRequest('game', REQUEST)).resolves.toBeDefined();
    await expect(banking.cancelTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
    });
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
    });
    expect([owner('zhitna'), owner('riga_rail')]).toEqual(['a', 'b']);

    await propose({ id: 'c0000000-0000-4000-8000-000000000002' });
    await expect(
      banking.cancelTradeRequest('game', 'c0000000-0000-4000-8000-000000000002'),
    ).resolves.toMatchObject({ tradeRequest: { state: 'CANCELLED' } });
  });

  it('expires a request after its time and refuses to accept it', async () => {
    const before = await proposed();
    database.exec("UPDATE trade_requests SET expires_at = '2000-01-01T00:00:00.000Z'");
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
      details: { state: 'EXPIRED' },
    });
    expect(stateOf()).toBe('EXPIRED');
    expect(count('transactions')).toBe(before.transactions);
  });

  it('rolls the whole batch back when the request stopped being pending at write time', async () => {
    const before = await proposed();
    await banking.declineTradeRequest('game', REQUEST);
    await expect(
      operations.persist({
        transactionId: 'd0000000-0000-4000-8000-000000000001',
        transaction: {
          gameId: 'game',
          type: 'PROPERTY_TRANSFER',
          amount: 5,
          totalAmount: 5,
          comment: null,
          participants: [
            { playerId: 'a', balanceDelta: -5 },
            { playerId: 'b', balanceDelta: 5 },
          ],
          initiatorPlayerId: 'a',
        },
        balanceChanges: [],
        acceptTradeRequestId: REQUEST,
      }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', cause: { message: /CHECK/ } });
    expect(count('transactions')).toBe(before.transactions);
    expect(stateOf()).toBe('DECLINED');
  });

  it('cancels the pending trades of a player who goes bankrupt, in the bankruptcy batch', async () => {
    await proposed();
    await propose({
      id: 'c0000000-0000-4000-8000-000000000003',
      counterpartyPlayerId: 'c',
      takeTileIds: [],
    });
    await banking.declareBankruptcy('game', { playerId: 'b' });
    expect(stateOf()).toBe('CANCELLED');
    // A trade between two players who are still in the game stays pending.
    expect(stateOf('c0000000-0000-4000-8000-000000000003')).toBe('PENDING');
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
    });
  });

  it('refuses to accept after a bankruptcy moved a traded tile to the creditor', async () => {
    await proposed({ takeTileIds: [], giveTileIds: ['zhitna'] });
    await banking.declareBankruptcy('game', { playerId: 'a', creditorPlayerId: 'c' });
    await expect(banking.acceptTradeRequest('game', REQUEST)).rejects.toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
    });
    expect(owner('zhitna')).toBe('c');
  });
});
