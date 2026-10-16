// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const ruleColumns = [
  'rule_double_go',
  'rule_player_loans',
  'rule_bank_loans',
  'rule_jackpot',
  'rule_auctions',
];

async function migratedDatabase(upTo?: string): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('./', import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && (upTo === undefined || name < upTo))
    .sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function insertGame(database: DatabaseSync, id: string, extra = ''): void {
  database.exec(
    `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode${extra === '' ? '' : ', ' + extra.split('=')[0]})
     VALUES ('${id}', 'Rules', 1500, 200, 'K', 'LOBBY', 'FAST'${extra === '' ? '' : ', ' + extra.split('=')[1]})`,
  );
}

describe('0020 game rules migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
  });

  it('turns every rule off for a game that does not set them', () => {
    insertGame(database, 'game-1');
    const row = database.prepare('SELECT * FROM games WHERE id = ?').get('game-1') as Record<
      string,
      unknown
    >;
    for (const column of ruleColumns) expect(row[column]).toBe(0);
    expect(row.settings_snapshot).toBeNull();
  });

  it('leaves games that existed before the migration with every rule off and no snapshot', async () => {
    const legacy = await migratedDatabase('0020');
    legacy.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('old', 'Old', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    );
    legacy.exec(await readFile(new URL('./0020_game_rules.sql', import.meta.url), 'utf8'));
    const row = legacy.prepare('SELECT * FROM games WHERE id = ?').get('old') as Record<
      string,
      unknown
    >;
    for (const column of ruleColumns) expect(row[column]).toBe(0);
    expect(row.settings_snapshot).toBeNull();
  });

  it.each(ruleColumns)('only accepts 0 or 1 in %s', (column) => {
    insertGame(database, 'ok', `${column}=1`);
    expect(() => insertGame(database, 'bad', `${column}=2`)).toThrow(/CHECK constraint failed/);
  });

  it('only accepts valid JSON as the settings snapshot', () => {
    insertGame(database, 'json', `settings_snapshot='{"unit":10}'`);
    expect(() => insertGame(database, 'broken', `settings_snapshot='{nope'`)).toThrow(
      /CHECK constraint failed/,
    );
  });
});
