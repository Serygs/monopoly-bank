import { describe, expect, it } from 'vitest';
import { D1DiceRollRepository, diceRollsKeptPerPlayer } from './dice-roll-repository.js';

interface Statement {
  sql: string;
  values: unknown[];
}

class FakeDatabase {
  readonly batches: Statement[][] = [];
  readonly queries: Statement[] = [];
  row: unknown = null;
  rows: unknown[] = [];

  prepare(sql: string) {
    const statement: Statement = { sql, values: [] };
    const bound = {
      ...statement,
      bind: (...values: unknown[]) => {
        statement.values = values;
        return Object.assign(bound, { values, sql });
      },
      first: async () => {
        this.queries.push(statement);
        return this.row;
      },
      all: async () => {
        this.queries.push(statement);
        return { results: this.rows };
      },
    };
    return bound;
  }

  async batch(statements: Statement[]) {
    this.batches.push(statements.map(({ sql, values }) => ({ sql, values })));
    return [];
  }
}

const row = {
  id: 'roll-1',
  player_id: 'player-1',
  die_one: 3,
  die_two: 4,
  created_at: '2026-10-15T10:00:00.123Z',
};

describe('D1DiceRollRepository', () => {
  it('inserts idempotently, prunes to the newest rolls in one batch, then reads the roll back', async () => {
    const database = new FakeDatabase();
    database.row = row;
    const repository = new D1DiceRollRepository(database as unknown as D1Database);

    const stored = await repository.record({
      id: 'roll-1',
      gameId: 'game-1',
      playerId: 'player-1',
      dieOne: 3,
      dieTwo: 4,
    });

    expect(database.batches).toHaveLength(1);
    const [insert, prune] = database.batches[0];
    expect(insert.sql).toContain('ON CONFLICT(id) DO NOTHING');
    expect(insert.values).toEqual(['roll-1', 'game-1', 'player-1', 3, 4]);
    expect(prune.sql).toContain('DELETE FROM dice_rolls');
    expect(prune.values).toEqual([
      'game-1',
      'player-1',
      'game-1',
      'player-1',
      diceRollsKeptPerPlayer,
    ]);
    expect(database.queries[0].values).toEqual(['roll-1', 'game-1', 'player-1']);
    expect(stored).toEqual({
      id: 'roll-1',
      playerId: 'player-1',
      dieOne: 3,
      dieTwo: 4,
      createdAt: '2026-10-15T10:00:00.123Z',
    });
  });

  it('returns null when the roll id already belongs to another player', async () => {
    const database = new FakeDatabase();
    database.row = null;
    const repository = new D1DiceRollRepository(database as unknown as D1Database);
    await expect(
      repository.record({
        id: 'roll-1',
        gameId: 'game-1',
        playerId: 'player-2',
        dieOne: 1,
        dieTwo: 1,
      }),
    ).resolves.toBeNull();
  });

  it("lists a player's rolls newest first with the requested limit", async () => {
    const database = new FakeDatabase();
    database.rows = [row, { ...row, id: 'roll-0', die_one: 6, die_two: 6 }];
    const repository = new D1DiceRollRepository(database as unknown as D1Database);

    const rolls = await repository.listForPlayer('game-1', 'player-1', 10);

    expect(database.queries[0].sql).toContain('ORDER BY created_at DESC, rowid DESC');
    expect(database.queries[0].values).toEqual(['game-1', 'player-1', 10]);
    expect(rolls.map((roll) => [roll.id, roll.dieOne, roll.dieTwo])).toEqual([
      ['roll-1', 3, 4],
      ['roll-0', 6, 6],
    ]);
  });
});
