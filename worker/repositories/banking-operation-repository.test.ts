import { describe, expect, it } from 'vitest';

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
});

class FakeDatabase {
  readonly batches: FakeStatement[][] = [];

  prepare(query: string): FakeStatement {
    return new FakeStatement(query);
  }

  async batch(statements: FakeStatement[]): Promise<[]> {
    this.batches.push(statements);
    return [];
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
