import { describe, expect, it } from 'vitest';

import { DatabaseError, PersistenceConsistencyError } from '../services/errors.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';

describe('D1BankingOperationRepository', () => {
  it('writes every balance update and the transaction history in one D1 batch', async () => {
    const database = new FakeDatabase();
    const repository = new D1BankingOperationRepository(database as unknown as D1Database);

    await repository.persist({
      transactionId: 'transaction-1',
      transaction: {
        gameId: 'game-1',
        type: 'PLAYER_TO_ALL',
        amount: 50,
        totalAmount: 100,
        comment: null,
        participants: [
          { playerId: 'payer', balanceDelta: -100 },
          { playerId: 'recipient-1', balanceDelta: 50 },
          { playerId: 'recipient-2', balanceDelta: 50 },
        ],
      },
      balanceChanges: [
        {
          player: { id: 'payer', gameId: 'game-1', name: 'Payer', color: '#111', balance: 150 },
          balanceBefore: 150,
          balanceAfter: 50,
          balanceDelta: -100,
        },
        {
          player: { id: 'recipient-1', gameId: 'game-1', name: 'Recipient 1', color: '#222', balance: 50 },
          balanceBefore: 50,
          balanceAfter: 100,
          balanceDelta: 50,
        },
        {
          player: { id: 'recipient-2', gameId: 'game-1', name: 'Recipient 2', color: '#333', balance: 50 },
          balanceBefore: 50,
          balanceAfter: 100,
          balanceDelta: 50,
        },
      ],
    });

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(5);
    expect(database.batches[0][0].values).toEqual([
      'payer', 150, 50,
      'recipient-1', 50, 100,
      'recipient-2', 50, 100,
      'game-1', 'payer', 'recipient-1', 'recipient-2',
    ]);
    expect(database.batches[0][1].values).toEqual([
      'transaction-1',
      'game-1',
      'PLAYER_TO_ALL',
      50,
      100,
      null,
    ]);
  });

  it('persists bankruptcy transfers using the database-supported operation type', async () => {
    const database = new FakeDatabase();
    const repository = new D1BankingOperationRepository(database as unknown as D1Database);

    await repository.persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'BANKRUPTCY_TRANSFER', amount: 400, totalAmount: 400, comment: null, participants: [{ playerId: 'bankrupt-player', balanceDelta: -400 }, { playerId: 'creditor', balanceDelta: 400 }] },
      balanceChanges: [
        { player: { id: 'bankrupt-player', gameId: 'game-1', name: 'Bankrupt', color: '#111', balance: 400 }, balanceBefore: 400, balanceAfter: 0, balanceDelta: -400 },
        { player: { id: 'creditor', gameId: 'game-1', name: 'Creditor', color: '#222', balance: 600 }, balanceBefore: 600, balanceAfter: 1000, balanceDelta: 400 },
      ],
      bankruptPlayerId: 'bankrupt-player',
    });

    expect(database.batches[0][1].values).toEqual(['transaction-1', 'game-1', 'BANKRUPTCY_TRANSFER', 400, 400, null]);
    expect(database.batches[0][4].values).toEqual(['bankrupt-player', 'game-1']);
  });

  it('writes deed, building bank, balances and the transaction of a purchase in one batch, deed first', async () => {
    const database = new FakeDatabase();
    await new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'PROPERTY_BUILD', amount: 50, totalAmount: 100, comment: null, participants: [{ playerId: 'ada', balanceDelta: -100 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 400, balanceDelta: -100 }],
      propertyChanges: [{ previous: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 1, mortgaged: false }, change: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 3, mortgaged: false } }],
      buildingBankDelta: { houses: -2, hotels: 0 },
    });

    expect(database.batches).toHaveLength(1);
    const [deed, bank, balance, transaction, participant] = database.batches[0];
    expect(database.batches[0]).toHaveLength(5);
    expect(deed.query).toContain('UPDATE game_properties');
    expect(deed.query).toContain('houses = CASE WHEN owner_player_id IS ? AND houses = ? AND mortgaged = ? THEN ? ELSE -1 END');
    expect(deed.values).toEqual(['ada', 'ada', 1, 0, 3, 0, 'game-1', 'space-01']);
    expect(bank.query).toContain('UPDATE game_building_banks SET houses_available = houses_available + ?, hotels_available = hotels_available + ?');
    expect(bank.values).toEqual([-2, 0, 'game-1']);
    expect(balance.query).toContain('UPDATE players');
    expect(transaction.values).toEqual(['transaction-1', 'game-1', 'PROPERTY_BUILD', 50, 100, null]);
    expect(participant.values).toEqual(['transaction-1', 'game-1', 'ada', -100]);
  });

  it('binds NULL as the previous owner of an unowned deed and skips an empty building-bank delta', async () => {
    const database = new FakeDatabase();
    await new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'PROPERTY_PURCHASE', amount: 60, totalAmount: 60, comment: null, participants: [{ playerId: 'ada', balanceDelta: -60 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 440, balanceDelta: -60 }],
      propertyChanges: [{ previous: { boardSpaceId: 'space-01', ownerPlayerId: null, houses: 0, mortgaged: false }, change: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 0, mortgaged: false } }],
      buildingBankDelta: { houses: 0, hotels: 0 },
    });
    expect(database.batches[0]).toHaveLength(4);
    expect(database.batches[0][0].values).toEqual(['ada', null, 0, 0, 0, 0, 'game-1', 'space-01']);
  });

  it('adds the jail flag, trade settlement and payment-request settlement to the same batch', async () => {
    const database = new FakeDatabase();
    await new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'JAIL_BAIL', amount: 50, totalAmount: 50, comment: null, participants: [{ playerId: 'ada', balanceDelta: -50 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 450, balanceDelta: -50 }],
      jailChange: { playerId: 'ada', isInJail: false },
      tradeSettlement: { tradeId: 'trade-1' },
      paymentRequestSettlement: { requestId: 'request-1' },
    });
    // jail flag, balance CAS, the transaction and its participant, then the two settlements that reference it
    const [jail, , transaction, participant, trade, paymentRequest] = database.batches[0];
    expect(database.batches[0]).toHaveLength(6);
    expect(transaction.query).toContain('INSERT INTO transactions (');
    expect(participant.query).toContain('INSERT INTO transaction_participants');
    expect(jail.query).toContain('UPDATE players SET is_in_jail = ? WHERE id = ? AND game_id = ?');
    expect(jail.values).toEqual([0, 'ada', 'game-1']);
    expect(trade.query).toContain("UPDATE property_trades");
    expect(trade.query).toContain("CASE WHEN state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'ACCEPTED' ELSE 'SETTLED_TWICE' END");
    expect(trade.values).toEqual(['transaction-1', 'game-1', 'trade-1']);
    expect(paymentRequest.query).toContain('UPDATE payment_requests');
    expect(paymentRequest.values).toEqual(['transaction-1', 'game-1', 'request-1']);
  });

  it('writes the transaction before the settlements that reference it, and still guards the settlement CAS', async () => {
    const database = new FakeDatabase();
    // deed CAS ok, balance ok, transaction ok, participant ok, trade settlement matched nothing
    database.results = [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 0 } }];
    await expect(new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'PROPERTY_TRADE', amount: 100, totalAmount: 100, comment: null, participants: [{ playerId: 'ada', balanceDelta: -100 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 400, balanceDelta: -100 }],
      propertyChanges: [{ previous: { boardSpaceId: 'space-01', ownerPlayerId: 'bob', houses: 0, mortgaged: false }, change: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 0, mortgaged: false } }],
      tradeSettlement: { tradeId: 'trade-1' },
    })).rejects.toBeInstanceOf(PersistenceConsistencyError);
    const queries = database.batches[0].map((statement) => statement.query);
    expect(queries.findIndex((query) => query.includes('INSERT INTO transactions ('))).toBeLessThan(queries.findIndex((query) => query.includes('UPDATE property_trades')));
  });

  it('fails with PersistenceConsistencyError when a compare-and-set deed update touched no row', async () => {
    const database = new FakeDatabase();
    // The first statement is the deed CAS; the fake reports it matched nothing while the rest succeeded.
    database.results = [{ meta: { changes: 0 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
    await expect(new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'PROPERTY_PURCHASE', amount: 60, totalAmount: 60, comment: null, participants: [{ playerId: 'ada', balanceDelta: -60 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 440, balanceDelta: -60 }],
      propertyChanges: [{ previous: { boardSpaceId: 'space-01', ownerPlayerId: null, houses: 0, mortgaged: false }, change: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 0, mortgaged: false } }],
    })).rejects.toBeInstanceOf(PersistenceConsistencyError);
    expect(database.batches).toHaveLength(1);
  });

  it('wraps a batch the database rejected — the CHECK a stale deed trips — as a DatabaseError, so nothing counts as applied', async () => {
    const database = new FakeDatabase();
    database.failWith = new Error('D1_ERROR: CHECK constraint failed: houses BETWEEN 0 AND 5');
    await expect(new D1BankingOperationRepository(database as unknown as D1Database).persist({
      transactionId: 'transaction-1',
      transaction: { gameId: 'game-1', type: 'PROPERTY_BUILD', amount: 50, totalAmount: 50, comment: null, participants: [{ playerId: 'ada', balanceDelta: -50 }] },
      balanceChanges: [{ player: { id: 'ada', gameId: 'game-1', name: 'Ada', color: '#111', balance: 500 }, balanceBefore: 500, balanceAfter: 450, balanceDelta: -50 }],
      propertyChanges: [{ previous: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 1, mortgaged: false }, change: { boardSpaceId: 'space-01', ownerPlayerId: 'ada', houses: 2, mortgaged: false } }],
      buildingBankDelta: { houses: -1, hotels: 0 },
    })).rejects.toBeInstanceOf(DatabaseError);
  });
});

/**
 * The real D1 checks `transaction_id` foreign keys (`payment_requests`, `property_trades`)
 * the moment a statement runs, even inside a batch. Mirror that here so a settlement
 * UPDATE that precedes the `transactions` INSERT fails the test the way it fails in D1.
 */
function enforceTransactionForeignKey(statements: FakeStatement[]): void {
  const inserted = new Set<string>();
  for (const statement of statements) {
    if (statement.query.includes('INSERT INTO transactions (')) inserted.add(String(statement.values[0]));
    if (/UPDATE (property_trades|payment_requests)/.test(statement.query) && statement.query.includes('transaction_id = ?')) {
      const transactionId = String(statement.values[0]);
      if (!inserted.has(transactionId)) throw new Error(`FOREIGN KEY constraint failed: transaction_id ${transactionId} is not inserted yet`);
    }
  }
}

class FakeDatabase {
  readonly batches: FakeStatement[][] = [];
  results: Array<{ meta: { changes: number } }> = [];
  failWith: Error | null = null;

  prepare(query: string): FakeStatement {
    return new FakeStatement(query);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.batches.push(statements);
    if (this.failWith !== null) throw this.failWith;
    enforceTransactionForeignKey(statements);
    return this.results;
  }
}

class FakeStatement {
  values: unknown[] = [];

  readonly query: string;

  constructor(query: string) {
    this.query = query;
  }

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }
}
