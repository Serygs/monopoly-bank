// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { D1GameRepository, type CreateGameInput } from './game-repository.js';
import { d1, exec, migrated, rows, seedGame, seedUser } from './test-support/sqlite-d1.test.js';

function input(id: string, extra: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    id,
    name: `Game ${id}`,
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'K',
    ownerUserId: 'owner',
    joinCode: id.toUpperCase(),
    gameAccessPasswordHash: null,
    gameAccessPasswordSalt: null,
    ...extra,
  };
}

function player(gameId: string, id: string, balance = 1500) {
  return { id, gameId, name: id, color: '#123456', balance };
}

describe('D1GameRepository behaviour', () => {
  let database: DatabaseSync;
  let games: D1GameRepository;

  beforeEach(async () => {
    database = await migrated();
    games = new D1GameRepository(d1(database));
    seedUser(database, 'owner');
    seedUser(database, 'guest');
  });

  describe('createWithPlayers', () => {
    it('stores defaults, links the first player to the owner and makes them its controller', async () => {
      await games.createWithPlayers(input('g1'), [player('g1', 'p1'), player('g1', 'p2', 900)]);
      const game = await games.getById('g1');
      expect(game).toMatchObject({
        id: 'g1',
        name: 'Game g1',
        startingBalance: 1500,
        passGoReward: 200,
        currency: 'K',
        paymentMode: 'FAST',
        rules: defaultGameRules,
        settings: null,
        status: 'LOBBY',
        startedAt: null,
        finishedAt: null,
      });
      expect(rows(database, 'SELECT id, balance FROM players ORDER BY id')).toEqual([
        { id: 'p1', balance: 1500 },
        { id: 'p2', balance: 900 },
      ]);
      expect(rows(database, 'SELECT user_id, role, player_id FROM game_members')).toEqual([
        { user_id: 'owner', role: 'OWNER', player_id: 'p1' },
      ]);
      expect(
        rows(database, 'SELECT player_id, user_id, controller_kind FROM player_controllers'),
      ).toEqual([{ player_id: 'p1', user_id: 'owner', controller_kind: 'PRIMARY' }]);
      expect(rows(database, 'SELECT is_public, join_code FROM games')).toEqual([
        { is_public: 0, join_code: 'G1' },
      ]);
    });

    it('creates a game without players as an owner membership with no player or control', async () => {
      await games.createWithPlayers(input('g1'), []);
      expect(rows(database, 'SELECT user_id, role, player_id FROM game_members')).toEqual([
        { user_id: 'owner', role: 'OWNER', player_id: null },
      ]);
      expect(rows(database, 'SELECT * FROM player_controllers')).toEqual([]);
    });

    it('stores the chosen payment mode, status, visibility and rules', async () => {
      await games.createWithPlayers(
        input('g1', {
          paymentMode: 'CONFIRMATION',
          status: 'ACTIVE',
          isPublic: true,
          rules: {
            doubleRewardOnExactGo: true,
            playerLoans: false,
            bankLoans: true,
            freeParkingJackpot: false,
            auctions: true,
          },
        }),
        [],
      );
      expect(await games.getById('g1')).toMatchObject({
        paymentMode: 'CONFIRMATION',
        status: 'ACTIVE',
        rules: {
          doubleRewardOnExactGo: true,
          playerLoans: false,
          bankLoans: true,
          freeParkingJackpot: false,
          auctions: true,
        },
      });
      expect(
        rows<{ is_public: number }>(database, 'SELECT is_public FROM games')[0].is_public,
      ).toBe(1);
    });

    it('stores each rule independently', async () => {
      const flags = [
        'doubleRewardOnExactGo',
        'playerLoans',
        'bankLoans',
        'freeParkingJackpot',
        'auctions',
      ] as const;
      for (const flag of flags) {
        const id = `g-${flag}`;
        await games.createWithPlayers(
          input(id, { rules: { ...defaultGameRules, [flag]: true } }),
          [],
        );
        const stored = (await games.getById(id))?.rules;
        expect(stored).toEqual({ ...defaultGameRules, [flag]: true });
      }
    });

    it('writes the access password material', async () => {
      await games.createWithPlayers(
        input('g1', { gameAccessPasswordHash: 'h', gameAccessPasswordSalt: 's' }),
        [],
      );
      expect(
        rows(
          database,
          'SELECT game_access_password_hash AS h, game_access_password_salt AS s FROM games',
        ),
      ).toEqual([{ h: 'h', s: 's' }]);
    });

    it('fails atomically when a player cannot be stored', async () => {
      await expect(
        games.createWithPlayers(input('g1'), [player('g1', 'p1', -5)]),
      ).rejects.toThrow();
      expect(rows(database, 'SELECT id FROM games')).toEqual([]);
      expect(rows(database, 'SELECT id FROM players')).toEqual([]);
      expect(rows(database, 'SELECT user_id FROM game_members')).toEqual([]);
    });

    it('seeds one property row per board tile', async () => {
      const settings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
      await games.createWithPlayers(input('g1', { settings }), []);
      const tiles = settings.board?.tiles ?? [];
      expect(tiles.length).toBeGreaterThan(0);
      expect(rows(database, 'SELECT COUNT(*) AS n FROM game_properties')[0]).toEqual({
        n: tiles.length,
      });
    });
  });

  describe('reading', () => {
    it('hides deleted games and reports status mapping', async () => {
      await games.createWithPlayers(input('lobby'), []);
      await games.createWithPlayers(input('active', { status: 'ACTIVE' }), []);
      exec(database, "UPDATE games SET status = 'ARCHIVED' WHERE id = 'lobby'");
      expect((await games.getById('lobby'))?.status).toBe('FINISHED');
      expect((await games.getById('active'))?.status).toBe('ACTIVE');
      expect(await games.getById('missing')).toBeNull();
      await games.softDelete('active');
      expect(await games.getById('active')).toBeNull();
    });

    it('treats an unreadable settings snapshot as no settings and reads a valid one', async () => {
      const settings = buildGameSettings(1500);
      await games.createWithPlayers(input('g1', { settings }), []);
      expect((await games.getById('g1'))?.settings).toEqual(settings);
      expect((await games.list())[0].settings).toEqual(settings);
    });

    it('reads the jackpot, zero when unknown or deleted', async () => {
      await games.createWithPlayers(input('g1'), []);
      expect(await games.getJackpot('g1')).toBe(0);
      exec(database, "UPDATE games SET jackpot_balance = 75 WHERE id = 'g1'");
      expect(await games.getJackpot('g1')).toBe(75);
      expect(await games.getJackpot('missing')).toBe(0);
      await games.softDelete('g1');
      expect(await games.getJackpot('g1')).toBe(0);
    });

    it('lists live games newest update first with a stable tie-break', async () => {
      for (const id of ['a', 'b', 'c']) await games.createWithPlayers(input(id), []);
      exec(database, "UPDATE games SET updated_at = '2024-01-01 00:00:00' WHERE id IN ('a', 'b')");
      exec(database, "UPDATE games SET updated_at = '2025-01-01 00:00:00' WHERE id = 'c'");
      await games.createWithPlayers(input('gone'), []);
      await games.softDelete('gone');
      expect((await games.list()).map((game) => game.id)).toEqual(['c', 'b', 'a']);
    });

    it('summarises games with player counts', async () => {
      await games.createWithPlayers(input('a'), [player('a', 'a1'), player('a', 'a2')]);
      await games.createWithPlayers(input('b'), []);
      exec(database, "UPDATE games SET updated_at = '2024-01-01 00:00:00' WHERE id = 'a'");
      exec(database, "UPDATE games SET updated_at = '2025-01-01 00:00:00' WHERE id = 'b'");
      await games.createWithPlayers(input('gone'), []);
      await games.softDelete('gone');
      const summaries = await games.listSummaries();
      expect(summaries.map((item) => [item.game.id, item.playerCount])).toEqual([
        ['b', 0],
        ['a', 2],
      ]);
      expect(summaries[1].game.name).toBe('Game a');
    });

    it('summarises for a user: own games plus public lobbies with their join code', async () => {
      await games.createWithPlayers(input('mine'), [player('mine', 'm1')]);
      await games.createWithPlayers(input('public', { isPublic: true }), []);
      await games.createWithPlayers(input('private'), []);
      await games.createWithPlayers(
        input('public-running', { isPublic: true, status: 'ACTIVE' }),
        [],
      );
      exec(
        database,
        "UPDATE games SET owner_user_id = 'guest' WHERE id IN ('public', 'private', 'public-running')",
      );
      exec(
        database,
        "UPDATE game_members SET user_id = 'guest' WHERE game_id IN ('public', 'private', 'public-running')",
      );
      exec(database, "UPDATE games SET updated_at = '2025-01-01 00:00:00' WHERE id = 'mine'");
      exec(database, "UPDATE games SET updated_at = '2024-01-01 00:00:00' WHERE id <> 'mine'");
      const summaries = await games.listSummariesForUser('owner');
      expect(summaries.map((item) => item.game.id)).toEqual(['mine', 'public']);
      expect(summaries[0]).toEqual({
        game: expect.objectContaining({ id: 'mine' }),
        playerCount: 1,
      });
      expect(summaries[1]).toMatchObject({
        playerCount: 0,
        isPublicLobby: true,
        joinCode: 'PUBLIC',
      });
      const own = await games.listSummariesForUser('guest');
      expect(own.map((item) => item.game.id).sort()).toEqual([
        'private',
        'public',
        'public-running',
      ]);
      expect(
        own.every((item) => item.isPublicLobby === undefined && item.joinCode === undefined),
      ).toBe(true);
    });

    it('does not list games without an owner or deleted ones for a user', async () => {
      seedGame(database, 'ownerless', { owner: null, status: 'LOBBY' });
      exec(database, 'UPDATE games SET is_public = 1');
      await games.createWithPlayers(input('gone'), []);
      await games.softDelete('gone');
      expect(await games.listSummariesForUser('owner')).toEqual([]);
    });

    it('lists deleted games of the owner with deletion and purge dates', async () => {
      await games.createWithPlayers(input('a'), [player('a', 'a1')]);
      await games.softDelete('a');
      const [item] = await games.listDeletedSummariesForUser('owner');
      expect(item.deletedAt).not.toBe('');
      expect(Date.parse(item.purgeAt) - Date.parse(item.deletedAt)).toBe(30 * 86_400_000);
      expect(item.playerCount).toBe(1);
      expect(await games.listDeletedSummariesForUser('guest')).toEqual([]);
    });
  });

  describe('updating', () => {
    beforeEach(async () => {
      await games.createWithPlayers(input('g1'), []);
    });

    it('renames a game and touches its update time', async () => {
      exec(database, "UPDATE games SET updated_at = '2000-01-01 00:00:00'");
      const updated = await games.updateMetadata({ id: 'g1', name: 'Renamed' });
      expect(updated).toMatchObject({
        id: 'g1',
        name: 'Renamed',
        status: 'LOBBY',
        finishedAt: null,
      });
      expect(updated?.updatedAt).not.toBe('2000-01-01 00:00:00');
    });

    it('changes the status and stamps finish time only when finishing', async () => {
      const active = await games.updateMetadata({ id: 'g1', status: 'ACTIVE' });
      expect(active).toMatchObject({ status: 'ACTIVE', finishedAt: null });
      const finished = await games.updateMetadata({ id: 'g1', status: 'FINISHED' });
      expect(finished?.status).toBe('FINISHED');
      expect(finished?.finishedAt).not.toBeNull();
      expect(rows<{ status: string }>(database, 'SELECT status FROM games')[0].status).toBe(
        'ARCHIVED',
      );
    });

    it('keeps the first finish time on later updates', async () => {
      await games.updateMetadata({ id: 'g1', status: 'FINISHED' });
      exec(database, "UPDATE games SET finished_at = '2001-01-01 00:00:00'");
      const again = await games.updateMetadata({ id: 'g1', name: 'x', status: 'ACTIVE' });
      expect(again).toMatchObject({
        name: 'x',
        status: 'ACTIVE',
        finishedAt: '2001-01-01 00:00:00',
      });
    });

    it('returns the game unchanged for an empty update and null for an unknown game', async () => {
      expect(await games.updateMetadata({ id: 'g1' })).toMatchObject({ id: 'g1', name: 'Game g1' });
      expect(await games.updateMetadata({ id: 'missing' })).toBeNull();
      expect(await games.updateMetadata({ id: 'missing', name: 'x' })).toBeNull();
    });

    it('moves a game between statuses only from the expected one', async () => {
      const started = await games.transitionStatus('g1', 'LOBBY', 'ACTIVE');
      expect(started?.status).toBe('ACTIVE');
      expect(started?.startedAt).not.toBeNull();
      expect(started?.finishedAt).toBeNull();
      expect(await games.transitionStatus('g1', 'LOBBY', 'ACTIVE')).toBeNull();
      expect(await games.transitionStatus('missing', 'LOBBY', 'ACTIVE')).toBeNull();
      const finished = await games.transitionStatus('g1', 'ACTIVE', 'FINISHED');
      expect(finished?.status).toBe('FINISHED');
      expect(finished?.finishedAt).not.toBeNull();
      expect(rows<{ status: string }>(database, 'SELECT status FROM games')[0].status).toBe(
        'ARCHIVED',
      );
      const reopened = await games.transitionStatus('g1', 'FINISHED', 'ACTIVE');
      expect(reopened?.status).toBe('ACTIVE');
      expect(reopened?.finishedAt).not.toBeNull();
    });

    it('keeps the start time when finishing', async () => {
      await games.transitionStatus('g1', 'LOBBY', 'ACTIVE');
      exec(database, "UPDATE games SET started_at = '2002-02-02 00:00:00'");
      const finished = await games.transitionStatus('g1', 'ACTIVE', 'FINISHED');
      expect(finished?.startedAt).toBe('2002-02-02 00:00:00');
    });

    it('replaces the join code for the owner of a running or lobby game only', async () => {
      expect(await games.replaceJoinCode('g1', 'owner', 'NEWCODE')).toBe(true);
      expect(
        rows<{ join_code: string }>(database, 'SELECT join_code FROM games')[0].join_code,
      ).toBe('NEWCODE');
      expect(await games.replaceJoinCode('g1', 'guest', 'OTHER')).toBe(false);
      expect(await games.replaceJoinCode('missing', 'owner', 'OTHER')).toBe(false);
      exec(database, "UPDATE games SET status = 'ACTIVE'");
      expect(await games.replaceJoinCode('g1', 'owner', 'ACTIVECODE')).toBe(true);
      exec(database, "UPDATE games SET status = 'ARCHIVED'");
      expect(await games.replaceJoinCode('g1', 'owner', 'LATE')).toBe(false);
      exec(database, "UPDATE games SET status = 'LOBBY', deleted_at = '2026-01-01'");
      expect(await games.replaceJoinCode('g1', 'owner', 'DELETED')).toBe(false);
      expect(
        rows<{ join_code: string }>(database, 'SELECT join_code FROM games')[0].join_code,
      ).toBe('ACTIVECODE');
    });

    it('surfaces a taken join code as a constraint failure', async () => {
      await games.createWithPlayers(input('g2'), []);
      await expect(games.replaceJoinCode('g1', 'owner', 'G2')).rejects.toThrow(/unique/i);
    });
  });

  describe('deleting', () => {
    it('hard deletes a game with its players and reports whether anything was deleted', async () => {
      await games.createWithPlayers(input('g1'), [player('g1', 'p1')]);
      expect(await games.delete('g1')).toBe(true);
      expect(rows(database, 'SELECT id FROM players')).toEqual([]);
      expect(await games.delete('g1')).toBe(false);
    });

    it('soft deletes once, finishing the game and keeping an existing finish time', async () => {
      await games.createWithPlayers(input('g1', { status: 'ACTIVE' }), []);
      exec(database, "UPDATE games SET finished_at = '2003-03-03 00:00:00' WHERE id = 'g1'");
      expect(await games.softDelete('g1')).toBe(true);
      expect(await games.softDelete('g1')).toBe(false);
      expect(await games.softDelete('missing')).toBe(false);
      expect(rows(database, 'SELECT status, finished_at FROM games')).toEqual([
        { status: 'ARCHIVED', finished_at: '2003-03-03 00:00:00' },
      ]);
    });

    it('stamps a finish time when soft deleting a game that never finished', async () => {
      await games.createWithPlayers(input('g1'), []);
      await games.softDelete('g1');
      expect(
        rows<{ finished_at: string | null }>(database, 'SELECT finished_at FROM games')[0]
          .finished_at,
      ).not.toBeNull();
    });

    it('restores within retention for the owner, not for others or after expiry', async () => {
      await games.createWithPlayers(input('g1'), []);
      expect(await games.restore('g1', 'owner')).toBe(false);
      await games.softDelete('g1');
      expect(await games.restore('g1', 'guest')).toBe(false);
      expect(await games.restore('g1', 'owner')).toBe(true);
      expect(await games.getById('g1')).not.toBeNull();
      await games.softDelete('g1');
      exec(
        database,
        "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days')",
      );
      expect(await games.restore('g1', 'owner')).toBe(false);
    });

    it('purges expired deleted games and leaves recent and live ones', async () => {
      for (const id of ['old', 'recent', 'live']) await games.createWithPlayers(input(id), []);
      await games.softDelete('old');
      await games.softDelete('recent');
      exec(
        database,
        "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'old'",
      );
      exec(
        database,
        "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 days') WHERE id = 'recent'",
      );
      await games.purgeExpiredDeleted();
      expect(
        rows<{ id: string }>(database, 'SELECT id FROM games ORDER BY id').map((row) => row.id),
      ).toEqual(['live', 'recent']);
    });
  });

  describe('amount shortcuts', () => {
    beforeEach(async () => {
      await games.createWithPlayers(input('g1'), []);
      await games.createWithPlayers(input('g2'), []);
    });

    it('toggles favourites on and off, newest first, per game', async () => {
      expect(await games.listFavoriteAmounts('g1')).toEqual([]);
      exec(
        database,
        "INSERT INTO game_favorite_amounts (game_id, amount, created_at) VALUES ('g1', 100, '2024-01-01 00:00:00')",
      );
      expect(await games.toggleFavoriteAmount('g1', 200)).toEqual([200, 100]);
      expect(await games.toggleFavoriteAmount('g2', 50)).toEqual([50]);
      expect(await games.toggleFavoriteAmount('g1', 200)).toEqual([100]);
      expect(await games.listFavoriteAmounts('g1')).toEqual([100]);
      expect(await games.listFavoriteAmounts('g2')).toEqual([50]);
    });

    it('breaks favourite ties by the larger amount first', async () => {
      exec(
        database,
        "INSERT INTO game_favorite_amounts (game_id, amount, created_at) VALUES ('g1', 10, '2024-01-01 00:00:00'), ('g1', 30, '2024-01-01 00:00:00'), ('g1', 20, '2024-01-01 00:00:00')",
      );
      expect(await games.listFavoriteAmounts('g1')).toEqual([30, 20, 10]);
    });

    it('keeps the five most recent amounts, moving a repeat to the front', async () => {
      for (const [index, amount] of [10, 20, 30, 40, 50, 60].entries()) {
        exec(
          database,
          "INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES ('g1', ?, ?)",
          amount,
          `2024-01-01 00:00:0${index}`,
        );
      }
      expect(await games.listRecentAmounts('g1')).toEqual([60, 50, 40, 30, 20]);
      await games.recordRecentAmount('g1', 30);
      expect(await games.listRecentAmounts('g1')).toEqual([30, 60, 50, 40, 20]);
      expect(await games.listRecentAmounts('g2')).toEqual([]);
    });

    it('trims stored recents to five and leaves other games alone', async () => {
      await games.recordRecentAmount('g2', 7);
      for (const [index, amount] of [1, 2, 3, 4, 5, 6, 7].entries()) {
        exec(
          database,
          "UPDATE game_recent_amounts SET used_at = ? WHERE game_id = 'g1' AND amount = ?",
          `2024-01-01 00:00:0${index}`,
          amount,
        );
        if (index < 7) {
          exec(
            database,
            "INSERT OR IGNORE INTO game_recent_amounts (game_id, amount, used_at) VALUES ('g1', ?, ?)",
            amount,
            `2024-01-01 00:00:0${index}`,
          );
        }
      }
      await games.recordRecentAmount('g1', 99);
      expect(await games.listRecentAmounts('g1')).toEqual([99, 7, 6, 5, 4]);
      expect(
        rows<{ recent_amounts: string }>(
          database,
          "SELECT recent_amounts FROM games WHERE id = 'g1'",
        ).map((row) => row.recent_amounts),
      ).toEqual(['[99,7,6,5,4]']);
      exec(
        database,
        "INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES ('g1', 500, '2099-01-01 00:00:00')",
      );
      expect(await games.listRecentAmounts('g1')).toEqual([99, 7, 6, 5, 4]);
      expect(await games.listRecentAmounts('g2')).toEqual([7]);
    });
  });
});
