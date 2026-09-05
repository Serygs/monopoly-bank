import { describe, expect, it } from 'vitest';

import { D1GameRepository } from './game-repository.js';

describe('D1GameRepository wallet control bootstrap', () => {
  it('creates the owner membership and primary wallet controller atomically', async () => {
    const database = new GameDatabase();
    const repository = new D1GameRepository(database as unknown as D1Database);

    await repository.createWithPlayers({
      id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'K', ownerUserId: 'owner', joinCode: 'TABLE42', gameAccessPasswordHash: null, gameAccessPasswordSalt: null,
    }, [{ id: 'owner-wallet', gameId: 'game', name: 'Owner', color: '#123456', balance: 1500 }]);

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0].map((statement) => statement.query)).toContain("INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES (?, ?, ?, 'PRIMARY')");
    expect(database.batches[0].at(-1)?.values).toEqual(['game', 'owner-wallet', 'owner']);
  });
});

class GameDatabase {
  readonly batches: GameStatement[][] = [];
  prepare(query: string): GameStatement { return new GameStatement(query); }
  async batch(statements: GameStatement[]): Promise<[]> { this.batches.push(statements); return []; }
}

class GameStatement {
  values: unknown[] = [];
  constructor(readonly query: string) {}
  bind(...values: unknown[]): this { this.values = values; return this; }
}
