// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { DELETED_GAME_RETENTION_DAYS } from '../../shared/contracts/api.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { D1GameAccessRepository } from './game-access-repository.js';
import { D1GameRepository } from './game-repository.js';

/** The slice of D1 the repositories use, backed by a real SQLite database. */
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
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    database.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seedGame(database: DatabaseSync, id: string, ownerId: string, status: string): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO users (id, nickname, avatar, password_hash, password_salt) VALUES (?, ?, 'x', 'h', 's')`,
    )
    .run(ownerId, ownerId);
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, owner_user_id, join_code)
       VALUES (?, ?, 1500, 200, 'USD', ?, 'FAST', ?, ?)`,
    )
    .run(id, `Game ${id}`, status, ownerId, `CODE-${id}`);
  database
    .prepare(
      `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, 'Ada', '#123456', 1500)`,
    )
    .run(`${id}-player`, id);
  database
    .prepare(
      `INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, 'OWNER', ?)`,
    )
    .run(id, ownerId, `${id}-player`);
}

function deletedAt(database: DatabaseSync, id: string): string | null {
  const row = database.prepare('SELECT deleted_at FROM games WHERE id = ?').get(id) as
    { deleted_at: string | null } | undefined;
  return row?.deleted_at ?? null;
}

function backdate(database: DatabaseSync, id: string, days: number): void {
  database
    .prepare(`UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) WHERE id = ?`)
    .run(`-${days} days`, id);
}

describe('D1GameRepository soft delete against SQLite', () => {
  let database: DatabaseSync;
  let games: D1GameRepository;
  let access: D1GameAccessRepository;
  beforeEach(async () => {
    database = await migrated();
    seedGame(database, 'active', 'owner', 'ACTIVE');
    seedGame(database, 'lobby', 'owner', 'LOBBY');
    seedGame(database, 'other', 'someone', 'ACTIVE');
    games = new D1GameRepository(d1(database));
    access = new D1GameAccessRepository(d1(database));
  });

  it('hides a deleted game everywhere and stores it as finished', async () => {
    expect(await games.softDelete('active')).toBe(true);

    expect(await games.getById('active')).toBeNull();
    expect((await games.listSummariesForUser('owner')).map((item) => item.game.id)).toEqual([
      'lobby',
    ]);
    expect(await access.getRole('active', 'owner')).toBeNull();
    const row = database
      .prepare('SELECT status, finished_at FROM games WHERE id = ?')
      .get('active');
    expect(row).toMatchObject({ status: 'ARCHIVED' });
    expect((row as { finished_at: string | null }).finished_at).not.toBeNull();
  });

  it('cannot delete the same game twice', async () => {
    expect(await games.softDelete('active')).toBe(true);
    expect(await games.softDelete('active')).toBe(false);
  });

  it("lists only the owner's deleted games, newest first, as finished with a purge date", async () => {
    await games.softDelete('active');
    backdate(database, 'active', 2);
    await games.softDelete('lobby');
    await games.softDelete('other');

    const deleted = await games.listDeletedSummariesForUser('owner');

    expect(deleted.map((item) => item.game.id)).toEqual(['lobby', 'active']);
    expect(deleted.every((item) => item.game.status === 'FINISHED')).toBe(true);
    const first = deleted[1];
    const expectedPurge = Date.parse(first.deletedAt) + DELETED_GAME_RETENTION_DAYS * 86_400_000;
    expect(Date.parse(first.purgeAt)).toBe(expectedPurge);
    expect(first.playerCount).toBe(1);
  });

  it('restores a deleted game for its owner only, keeping it finished', async () => {
    await games.softDelete('active');

    expect(await games.restore('active', 'someone')).toBe(false);
    expect(await games.restore('active', 'owner')).toBe(true);

    expect(deletedAt(database, 'active')).toBeNull();
    expect((await games.getById('active'))?.status).toBe('FINISHED');
    expect(await games.restore('active', 'owner')).toBe(false);
  });

  it('no longer lists or restores a game deleted more than 30 days ago', async () => {
    await games.softDelete('active');
    backdate(database, 'active', DELETED_GAME_RETENTION_DAYS + 1);

    expect(await games.listDeletedSummariesForUser('owner')).toEqual([]);
    expect(await games.restore('active', 'owner')).toBe(false);
  });

  it('purges only expired deleted games, with their players', async () => {
    await games.softDelete('active');
    backdate(database, 'active', DELETED_GAME_RETENTION_DAYS + 1);
    await games.softDelete('lobby');
    backdate(database, 'lobby', DELETED_GAME_RETENTION_DAYS - 1);

    await games.purgeExpiredDeleted();

    const remaining = database.prepare('SELECT id FROM games ORDER BY id').all() as {
      id: string;
    }[];
    expect(remaining.map((row) => row.id)).toEqual(['lobby', 'other']);
    const players = database.prepare('SELECT id FROM players ORDER BY id').all() as {
      id: string;
    }[];
    expect(players.map((row) => row.id)).toEqual(['lobby-player', 'other-player']);
  });
});

describe('D1GameRepository house rules', () => {
  let database: DatabaseSync;
  let games: D1GameRepository;
  beforeEach(async () => {
    database = await migrated();
    games = new D1GameRepository(d1(database));
    database
      .prepare(
        `INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES ('owner', 'owner', 'x', 'h', 's')`,
      )
      .run();
  });

  const create = (
    id: string,
    extra: Partial<Parameters<D1GameRepository['createWithPlayers']>[0]>,
  ) =>
    games.createWithPlayers(
      {
        id,
        name: id,
        startingBalance: 15_000_000,
        passGoReward: 2_000_000,
        currency: 'USD',
        ownerUserId: 'owner',
        joinCode: id.toUpperCase(),
        gameAccessPasswordHash: null,
        gameAccessPasswordSalt: null,
        ...extra,
      },
      [{ id: `${id}-p`, gameId: id, name: 'Ada', color: '#123456', balance: 15_000_000 }],
    );

  it('stores the chosen rules and the settings snapshot and reads them back', async () => {
    const settings = buildGameSettings(15_000_000);
    await create('ruled', {
      rules: { ...defaultGameRules, playerLoans: true, auctions: true },
      settings,
    });

    const game = await games.getById('ruled');
    expect(game?.rules).toEqual({ ...defaultGameRules, playerLoans: true, auctions: true });
    expect(game?.settings).toEqual(settings);
    const [summary] = await games.listSummariesForUser('owner');
    expect(summary?.game.rules.playerLoans).toBe(true);
  });

  it('turns every rule off and keeps no snapshot when none is given', async () => {
    await create('plain', {});

    const game = await games.getById('plain');
    expect(game?.rules).toEqual(defaultGameRules);
    expect(game?.settings).toBeNull();
  });

  it('keeps the rules through status transitions', async () => {
    await create('started', { rules: { ...defaultGameRules, bankLoans: true } });
    const started = await games.transitionStatus('started', 'LOBBY', 'ACTIVE');
    expect(started?.rules.bankLoans).toBe(true);
  });
});
