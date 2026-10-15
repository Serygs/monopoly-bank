// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

async function migratedDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('./', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seedGame(database: DatabaseSync, id: string, status = 'ACTIVE'): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES (?, 'Dice', 1500, 200, 'K', ?, 'FAST')`,
    )
    .run(id, status);
  database
    .prepare(
      `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, 'Ada', '#123456', 1500)`,
    )
    .run(`${id}-player`, id);
}

function roll(database: DatabaseSync, id: string, gameId: string, one = 3, two = 4): void {
  database
    .prepare(
      'INSERT INTO dice_rolls (id, game_id, player_id, die_one, die_two) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, gameId, `${gameId}-player`, one, two);
}

function count(database: DatabaseSync, gameId: string): number {
  const row = database
    .prepare('SELECT COUNT(*) AS total FROM dice_rolls WHERE game_id = ?')
    .get(gameId) as { total: number };
  return row.total;
}

describe('0018 dice rolls migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
  });

  it('only accepts faces from 1 to 6', () => {
    seedGame(database, 'game-1');
    expect(() => roll(database, 'bad-low', 'game-1', 0, 3)).toThrow(/CHECK constraint/i);
    expect(() => roll(database, 'bad-high', 'game-1', 3, 7)).toThrow(/CHECK constraint/i);
    roll(database, 'ok', 'game-1', 6, 1);
    expect(count(database, 'game-1')).toBe(1);
  });

  it('stamps rolls with millisecond precision so quick rolls keep their order', () => {
    seedGame(database, 'game-1');
    roll(database, 'one', 'game-1');
    const row = database.prepare('SELECT created_at FROM dice_rolls WHERE id = ?').get('one') as {
      created_at: string;
    };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("removes a finished game's rolls and keeps every other game's", () => {
    seedGame(database, 'game-1');
    seedGame(database, 'game-2');
    roll(database, 'a', 'game-1');
    roll(database, 'b', 'game-1');
    roll(database, 'c', 'game-2');

    database.prepare("UPDATE games SET status = 'ARCHIVED' WHERE id = 'game-1'").run();

    expect(count(database, 'game-1')).toBe(0);
    expect(count(database, 'game-2')).toBe(1);
  });

  it('keeps the rolls through unrelated game updates', () => {
    seedGame(database, 'game-1');
    roll(database, 'a', 'game-1');
    database.prepare("UPDATE games SET name = 'Renamed' WHERE id = 'game-1'").run();
    expect(count(database, 'game-1')).toBe(1);
  });

  it('does not clear anything for a game that was already finished', () => {
    seedGame(database, 'game-1', 'ARCHIVED');
    expect(count(database, 'game-1')).toBe(0);
    database.prepare("UPDATE games SET name = 'Archive' WHERE id = 'game-1'").run();
    expect(count(database, 'game-1')).toBe(0);
  });

  it("deletes a game's rolls together with the game", () => {
    seedGame(database, 'game-1');
    roll(database, 'a', 'game-1');
    database.prepare("DELETE FROM games WHERE id = 'game-1'").run();
    expect(count(database, 'game-1')).toBe(0);
  });

  it('rejects a roll for a player that is not in the game', () => {
    seedGame(database, 'game-1');
    seedGame(database, 'game-2');
    expect(() =>
      database
        .prepare(
          'INSERT INTO dice_rolls (id, game_id, player_id, die_one, die_two) VALUES (?, ?, ?, 1, 1)',
        )
        .run('stray', 'game-1', 'game-2-player'),
    ).toThrow(/FOREIGN KEY/i);
  });
});
