import { describe, expect, it } from 'vitest';

import { D1TransactionRepository } from './transaction-repository.js';

describe('D1TransactionRepository', () => {
  it('writes a transaction and all participant records in one D1 batch', async () => {
    const database = new FakeDatabase();
    const repository = new D1TransactionRepository(database as unknown as D1Database);
    await repository.create({ id: 'transaction-1', gameId: 'game-1', type: 'PLAYER_TO_ALL', amount: 50, totalAmount: 100, participants: [{ playerId: 'payer', balanceDelta: -100 }, { playerId: 'recipient-1', balanceDelta: 50 }, { playerId: 'recipient-2', balanceDelta: 50 }] });
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(4);
    expect(database.batches[0][0].values).toEqual(['transaction-1', 'game-1', 'PLAYER_TO_ALL', 50, 100, null]);
    expect(database.batches[0].slice(1).map((statement) => statement.values)).toEqual([['transaction-1', 'game-1', 'payer', -100], ['transaction-1', 'game-1', 'recipient-1', 50], ['transaction-1', 'game-1', 'recipient-2', 50]]);
  });

  it('returns a zero-balance bankruptcy transaction with no balance participants', async () => {
    const database = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: 'transaction', game_id: 'game', type: 'BANKRUPTCY_TRANSFER', amount: 1, total_amount: 1, comment: null, created_at: '2026-01-01', player_id: null, balance_delta: null }] }) }) }) };
    const transaction = await new D1TransactionRepository(database as unknown as D1Database).getById('game', 'transaction');
    expect(transaction).toMatchObject({ id: 'transaction', participants: [] });
  });
});

class FakeDatabase {
  readonly batches: FakeStatement[][] = [];
  prepare(query: string): FakeStatement { return new FakeStatement(query); }
  async batch(statements: FakeStatement[]): Promise<[]> { this.batches.push(statements); return []; }
}

class FakeStatement {
  values: unknown[] = [];
  readonly query: string;
  constructor(query: string) { this.query = query; }
  bind(...values: unknown[]): this { this.values = values; return this; }
}
