// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1DiceRollRepository, diceRollsKeptPerPlayer } from './dice-roll-repository.js';

/** The slice of D1 the repository uses, backed by a real SQLite database. */
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
        database.prepare(sql).run(...values);
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  };
  return {
    prepare,
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seed(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game-1', 'Dice', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run();
  for (const id of ['player-1', 'player-2'])
    database
      .prepare(
        `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, 'game-1', ?, '#123456', 1500)`,
      )
      .run(id, id);
}

describe('D1DiceRollRepository against SQLite', () => {
  let database: DatabaseSync;
  let repository: D1DiceRollRepository;
  beforeEach(async () => {
    database = await migrated();
    seed(database);
    repository = new D1DiceRollRepository(d1(database));
  });

  const roll = (id: string, playerId = 'player-1', dieOne = 1, dieTwo = 2) => ({
    id,
    gameId: 'game-1',
    playerId,
    dieOne,
    dieTwo,
  });

  it('stores a roll and returns it', async () => {
    const stored = await repository.record(roll('roll-1', 'player-1', 3, 4));
    expect(stored).toMatchObject({ id: 'roll-1', playerId: 'player-1', dieOne: 3, dieTwo: 4 });
    expect(stored?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('is idempotent for a retried roll id', async () => {
    await repository.record(roll('roll-1', 'player-1', 3, 4));
    const again = await repository.record(roll('roll-1', 'player-1', 6, 6));
    expect(again).toMatchObject({ dieOne: 3, dieTwo: 4 });
    expect(await repository.listForPlayer('game-1', 'player-1', 10)).toHaveLength(1);
  });

  it('refuses a roll id that another player already used', async () => {
    await repository.record(roll('roll-1', 'player-1'));
    await expect(repository.record(roll('roll-1', 'player-2'))).resolves.toBeNull();
  });

  it('lists newest first even when rolls share a timestamp', async () => {
    database.exec(
      `INSERT INTO dice_rolls (id, game_id, player_id, die_one, die_two, created_at) VALUES
        ('a', 'game-1', 'player-1', 1, 1, '2026-10-15T10:00:00.000Z'),
        ('b', 'game-1', 'player-1', 2, 2, '2026-10-15T10:00:00.000Z'),
        ('c', 'game-1', 'player-1', 3, 3, '2026-10-15T10:00:01.000Z')`,
    );
    const rolls = await repository.listForPlayer('game-1', 'player-1', 10);
    expect(rolls.map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(
      (await repository.listForPlayer('game-1', 'player-1', 2)).map((item) => item.id),
    ).toEqual(['c', 'b']);
  });

  it("keeps each player's history separate", async () => {
    await repository.record(roll('mine', 'player-1'));
    await repository.record(roll('theirs', 'player-2'));
    expect((await repository.listForPlayer('game-1', 'player-1', 10)).map((r) => r.id)).toEqual([
      'mine',
    ]);
  });

  it('prunes a player to the newest rolls without touching others', async () => {
    for (let index = 0; index < diceRollsKeptPerPlayer + 5; index += 1)
      await repository.record(roll(`roll-${String(index).padStart(3, '0')}`));
    await repository.record(roll('other', 'player-2'));

    const kept = await repository.listForPlayer('game-1', 'player-1', 100);
    expect(kept).toHaveLength(diceRollsKeptPerPlayer);
    expect(kept[0].id).toBe(`roll-${String(diceRollsKeptPerPlayer + 4).padStart(3, '0')}`);
    expect(kept.at(-1)?.id).toBe('roll-005');
    expect(await repository.listForPlayer('game-1', 'player-2', 10)).toHaveLength(1);
  });
});
