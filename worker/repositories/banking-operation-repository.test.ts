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
          player: {
            id: 'recipient-1',
            gameId: 'game-1',
            name: 'Recipient 1',
            color: '#222',
            balance: 50,
          },
          balanceBefore: 50,
          balanceAfter: 100,
          balanceDelta: 50,
        },
        {
          player: {
            id: 'recipient-2',
            gameId: 'game-1',
            name: 'Recipient 2',
            color: '#333',
            balance: 50,
          },
          balanceBefore: 50,
          balanceAfter: 100,
          balanceDelta: 50,
        },
      ],
    });

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(5);
    expect(database.batches[0][0].values).toEqual([
      'payer',
      150,
      50,
      'recipient-1',
      50,
      100,
      'recipient-2',
      50,
      100,
      'game-1',
      'payer',
      'recipient-1',
      'recipient-2',
    ]);
    expect(database.batches[0][1].values).toEqual([
      'transaction-1',
      'game-1',
      'PLAYER_TO_ALL',
      50,
      100,
      null,
      null,
      null,
    ]);
  });

  it('persists bankruptcy transfers using the database-supported operation type', async () => {
    const database = new FakeDatabase();
    const repository = new D1BankingOperationRepository(database as unknown as D1Database);

    await repository.persist({
      transactionId: 'transaction-1',
      transaction: {
        gameId: 'game-1',
        type: 'BANKRUPTCY_TRANSFER',
        amount: 400,
        totalAmount: 400,
        comment: null,
        participants: [
          { playerId: 'bankrupt-player', balanceDelta: -400 },
          { playerId: 'creditor', balanceDelta: 400 },
        ],
      },
      balanceChanges: [
        {
          player: {
            id: 'bankrupt-player',
            gameId: 'game-1',
            name: 'Bankrupt',
            color: '#111',
            balance: 400,
          },
          balanceBefore: 400,
          balanceAfter: 0,
          balanceDelta: -400,
        },
        {
          player: {
            id: 'creditor',
            gameId: 'game-1',
            name: 'Creditor',
            color: '#222',
            balance: 600,
          },
          balanceBefore: 600,
          balanceAfter: 1000,
          balanceDelta: 400,
        },
      ],
      bankruptPlayerId: 'bankrupt-player',
    });

    expect(database.batches[0][1].values).toEqual([
      'transaction-1',
      'game-1',
      'BANKRUPTCY_TRANSFER',
      400,
      400,
      null,
      null,
      null,
    ]);
    expect(database.batches[0][4].values).toEqual(['bankrupt-player', 'game-1']);
  });

  it('links a reversal to the transaction it moves back in the same batch', async () => {
    const database = new FakeDatabase();
    const repository = new D1BankingOperationRepository(database as unknown as D1Database);

    await repository.persist({
      transactionId: 'reversal-1',
      transaction: {
        gameId: 'game-1',
        type: 'REVERSAL',
        amount: 50,
        totalAmount: 50,
        comment: 'wrong player',
        reversesTransactionId: 'transaction-1',
        participants: [
          { playerId: 'payer', balanceDelta: 50 },
          { playerId: 'recipient', balanceDelta: -50 },
        ],
      },
      balanceChanges: [
        {
          player: { id: 'payer', gameId: 'game-1', name: 'Payer', color: '#111', balance: 0 },
          balanceBefore: 0,
          balanceAfter: 50,
          balanceDelta: 50,
        },
        {
          player: { id: 'recipient', gameId: 'game-1', name: 'R', color: '#222', balance: 90 },
          balanceBefore: 90,
          balanceAfter: 40,
          balanceDelta: -50,
        },
      ],
    });

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0][1].values).toEqual([
      'reversal-1',
      'game-1',
      'REVERSAL',
      50,
      50,
      'wrong player',
      'transaction-1',
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
