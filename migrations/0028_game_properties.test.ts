// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function migratedDatabase(before?: string): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && (before === undefined || name < before))
    .sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seedGame(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES (?, 'Props', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  database
    .prepare(
      `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, 'p', '#123456', 1500)`,
    )
    .run(`${id}-a`, id);
}

function insertProperty(
  database: DatabaseSync,
  tile: string,
  values: { game?: string; owner?: string | null; mortgaged?: number; houses?: number } = {},
): void {
  database
    .prepare(
      `INSERT INTO game_properties (game_id, tile_id, owner_player_id, mortgaged, houses)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      values.game ?? 'game',
      tile,
      values.owner === undefined ? null : values.owner,
      values.mortgaged ?? 0,
      values.houses ?? 0,
    );
}

describe('0028 game_properties', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database, 'game');
    seedGame(database, 'other');
  });

  it('defaults to unowned, unmortgaged and no houses', () => {
    database
      .prepare(`INSERT INTO game_properties (game_id, tile_id) VALUES ('game', 'mediterranean')`)
      .run();
    expect(database.prepare('SELECT * FROM game_properties').get()).toMatchObject({
      owner_player_id: null,
      mortgaged: 0,
      houses: 0,
    });
  });

  it('rejects a duplicate tile in the same game but allows it in another', () => {
    insertProperty(database, 't1');
    expect(() => insertProperty(database, 't1')).toThrow();
    insertProperty(database, 't1', { game: 'other' });
  });

  it('rejects invalid mortgaged values', () => {
    expect(() => insertProperty(database, 't1', { mortgaged: 2 })).toThrow();
    expect(() => insertProperty(database, 't1', { mortgaged: -1 })).toThrow();
  });

  it('keeps houses between 0 and 5', () => {
    insertProperty(database, 't1', { houses: 5 });
    expect(() => insertProperty(database, 't2', { houses: 6 })).toThrow();
    expect(() => insertProperty(database, 't3', { houses: -1 })).toThrow();
  });

  it('rejects houses on a mortgaged property', () => {
    expect(() => insertProperty(database, 't1', { mortgaged: 1, houses: 1 })).toThrow();
    insertProperty(database, 't2', { mortgaged: 1 });
    expect(() =>
      database.prepare(`UPDATE game_properties SET houses = 1 WHERE tile_id = 't2'`).run(),
    ).toThrow();
  });

  it('rejects an owner from another game', () => {
    expect(() => insertProperty(database, 't1', { owner: 'other-a' })).toThrow();
    insertProperty(database, 't2', { owner: 'game-a' });
  });

  it('restricts deleting an owning player', () => {
    insertProperty(database, 't1', { owner: 'game-a' });
    expect(() => database.prepare(`DELETE FROM players WHERE id = 'game-a'`).run()).toThrow();
  });

  it('cascades when the game is deleted', () => {
    insertProperty(database, 't1', { owner: 'game-a' });
    insertProperty(database, 't2', { game: 'other' });
    database.prepare(`DELETE FROM games WHERE id = 'game'`).run();
    expect(database.prepare('SELECT game_id FROM game_properties').all()).toEqual([
      { game_id: 'other' },
    ]);
  });

  it('gives legacy games no rows', async () => {
    const legacy = await migratedDatabase('0028');
    seedGame(legacy, 'old');
    legacy.exec(await readFile(new URL('0028_game_properties.sql', directory), 'utf8'));
    expect(legacy.prepare('SELECT COUNT(*) AS n FROM game_properties').get()).toEqual({ n: 0 });
  });
});
