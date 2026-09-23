import { describe, expect, it } from 'vitest';

import { D1PropertyTradeRepository } from './property-trade-repository.js';

describe('D1PropertyTradeRepository', () => {
  it('writes the trade and every deed item in one D1 batch', async () => {
    const database = new FakeDatabase();
    await new D1PropertyTradeRepository(database as unknown as D1Database).create({
      trade: { id: 'trade-1', gameId: 'game-1', proposerPlayerId: 'ada', responderPlayerId: 'lin', cashFromProposer: 100, cashFromResponder: 0, state: 'PENDING', expiresAt: '2999-01-01T00:00:00.000Z' },
      items: [{ boardSpaceId: 'space-01', fromPlayerId: 'ada', mortgageResolution: null }, { boardSpaceId: 'space-05', fromPlayerId: 'lin', mortgageResolution: 'REDEEM' }],
      boardId: 'board-classic',
    });
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(3);
    expect(database.batches[0][0].values).toEqual(['trade-1', 'game-1', 'ada', 'lin', 100, 0, 'PENDING', '2999-01-01T00:00:00.000Z']);
    expect(database.batches[0][1].values).toEqual(['trade-1', 'game-1', 'space-01', 'board-classic', 'ada', null]);
    expect(database.batches[0][2].values).toEqual(['trade-1', 'game-1', 'space-05', 'board-classic', 'lin', 'REDEEM']);
  });

  it('groups item rows under their trade and reads an overdue pending offer as EXPIRED', async () => {
    const base = { game_id: 'game-1', proposer_player_id: 'ada', responder_player_id: 'lin', cash_from_proposer: 0, cash_from_responder: 50, created_at: '2026-01-01', resolved_at: null, transaction_id: null };
    const database = new FakeDatabase([
      { ...base, id: 'fresh', state: 'PENDING', expires_at: '2999-01-01T00:00:00.000Z', item_board_space_id: 'space-01', item_from_player_id: 'ada', item_mortgage_resolution: null },
      { ...base, id: 'fresh', state: 'PENDING', expires_at: '2999-01-01T00:00:00.000Z', item_board_space_id: 'space-03', item_from_player_id: 'ada', item_mortgage_resolution: 'PAY_INTEREST' },
      { ...base, id: 'stale', state: 'PENDING', expires_at: '2000-01-01T00:00:00.000Z', item_board_space_id: null, item_from_player_id: null, item_mortgage_resolution: null },
    ]);
    const trades = await new D1PropertyTradeRepository(database as unknown as D1Database).listByGameId('game-1');
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ id: 'fresh', state: 'PENDING', items: [{ boardSpaceId: 'space-01', fromPlayerId: 'ada', mortgageResolution: null }, { boardSpaceId: 'space-03', fromPlayerId: 'ada', mortgageResolution: 'PAY_INTEREST' }] });
    expect(trades[1]).toMatchObject({ id: 'stale', state: 'EXPIRED', items: [] });
  });

  it('sweeps every overdue pending offer across games into EXPIRED, bound to the moment the sweep ran', async () => {
    const database = new FakeDatabase();
    await new D1PropertyTradeRepository(database as unknown as D1Database).expireOverdue(new Date('2026-06-01T12:00:00.000Z'));
    const statement = database.statements.at(-1);
    expect(statement?.query).toMatch(/UPDATE property_trades SET state = 'EXPIRED'/u);
    expect(statement?.query).toMatch(/WHERE state = 'PENDING' AND expires_at < \?/u);
    expect(statement?.query).not.toContain('game_id');
    expect(statement?.values).toEqual(['2026-06-01T12:00:00.000Z']);
  });

  it('declines or cancels only a pending trade of the given game', async () => {
    const database = new FakeDatabase();
    await new D1PropertyTradeRepository(database as unknown as D1Database).resolve('game-1', 'trade-1', 'CANCELLED');
    const statement = database.statements.at(-1);
    expect(statement?.query).toContain("WHERE game_id = ? AND id = ? AND state = 'PENDING'");
    expect(statement?.values).toEqual(['CANCELLED', 'game-1', 'trade-1']);
  });
});

class FakeDatabase {
  readonly batches: FakeStatement[][] = [];
  readonly statements: FakeStatement[] = [];
  constructor(private readonly rows: unknown[] = []) {}
  prepare(query: string): FakeStatement { const statement = new FakeStatement(query, this.rows); this.statements.push(statement); return statement; }
  async batch(statements: FakeStatement[]): Promise<[]> { this.batches.push(statements); return []; }
}

class FakeStatement {
  values: unknown[] = [];
  constructor(readonly query: string, private readonly rows: unknown[]) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.rows as T[] }; }
  async run(): Promise<{ meta: { changes: number } }> { return { meta: { changes: 1 } }; }
}
