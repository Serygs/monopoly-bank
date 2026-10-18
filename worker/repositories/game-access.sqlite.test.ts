// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1GameAccessRepository } from './game-access-repository.js';
import {
  d1,
  exec,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

const future = '2999-01-01T00:00:00.000Z';

describe('D1GameAccessRepository', () => {
  let database: DatabaseSync;
  let repository: D1GameAccessRepository;

  const join = (userId: string, playerId: string, gameId = 'lobby') =>
    repository.joinLobby({
      gameId,
      userId,
      nickname: `n-${playerId}`,
      playerId,
      color: '#abc',
      startingBalance: 1500,
    });

  beforeEach(async () => {
    database = await migrated();
    repository = new D1GameAccessRepository(d1(database));
    seedUser(database, 'owner');
    seedUser(database, 'u1');
    seedUser(database, 'u2');
    seedGame(database, 'lobby', { owner: 'owner', status: 'LOBBY', joinCode: 'CODE1234' });
  });

  describe('roles and membership', () => {
    it('returns the role of a member and null for strangers', async () => {
      await repository.addMember('lobby', 'owner', 'OWNER');
      await repository.addMember('lobby', 'u1', 'PLAYER');
      expect(await repository.getRole('lobby', 'owner')).toBe('OWNER');
      expect(await repository.getRole('lobby', 'u1')).toBe('PLAYER');
      expect(await repository.getRole('lobby', 'u2')).toBeNull();
      expect(await repository.getRole('other', 'u1')).toBeNull();
    });

    it('hides games without an owner or soft-deleted ones', async () => {
      seedGame(database, 'ownerless', { owner: null });
      await repository.addMember('ownerless', 'u1', 'PLAYER');
      expect(await repository.getRole('ownerless', 'u1')).toBeNull();
      await repository.addMember('lobby', 'u1', 'PLAYER');
      exec(database, "UPDATE games SET deleted_at = '2026-01-01' WHERE id = 'lobby'");
      expect(await repository.getRole('lobby', 'u1')).toBeNull();
    });

    it('upgrades a role on repeat but keeps the first linked player', async () => {
      seedPlayer(database, 'p1', 'lobby');
      seedPlayer(database, 'p2', 'lobby');
      await repository.addMember('lobby', 'u1', 'PLAYER');
      await repository.addMember('lobby', 'u1', 'OWNER', 'p1');
      await repository.addMember('lobby', 'u1', 'PLAYER', 'p2');
      expect(
        rows(database, "SELECT role, player_id FROM game_members WHERE user_id = 'u1'"),
      ).toEqual([{ role: 'PLAYER', player_id: 'p1' }]);
    });

    it('lists linked members', async () => {
      seedPlayer(database, 'p1', 'lobby');
      await repository.addMember('lobby', 'owner', 'OWNER', 'p1');
      await repository.addMember('lobby', 'u1', 'PLAYER');
      expect(await repository.listLinkedMembers('lobby')).toHaveLength(2);
      expect(await repository.listLinkedMembers('lobby')).toEqual(
        expect.arrayContaining([
          { userId: 'owner', playerId: 'p1' },
          { userId: 'u1', playerId: null },
        ]),
      );
      expect(await repository.listLinkedMembers('other')).toEqual([]);
    });
  });

  describe('joinLobby', () => {
    it('creates the player, membership and primary control in one step', async () => {
      expect(await join('u1', 'p1')).toBe(true);
      expect(rows(database, 'SELECT id, game_id, name, color, balance FROM players')).toEqual([
        { id: 'p1', game_id: 'lobby', name: 'n-p1', color: '#abc', balance: 1500 },
      ]);
      expect(rows(database, 'SELECT user_id, role, player_id FROM game_members')).toEqual([
        { user_id: 'u1', role: 'PLAYER', player_id: 'p1' },
      ]);
      expect(await repository.listPlayerControllers('lobby', 'u1')).toEqual([
        { playerId: 'p1', kind: 'PRIMARY' },
      ]);
    });

    it('is idempotent for an existing member', async () => {
      await join('u1', 'p1');
      expect(await join('u1', 'p2')).toBe(true);
      expect(rows(database, 'SELECT id FROM players')).toHaveLength(1);
    });

    it('refuses a game that has started and leaves no trace', async () => {
      exec(database, "UPDATE games SET status = 'ACTIVE' WHERE id = 'lobby'");
      expect(await join('u1', 'p1')).toBe(false);
      expect(rows(database, 'SELECT id FROM players')).toEqual([]);
      expect(rows(database, 'SELECT user_id FROM game_members')).toEqual([]);
      expect(rows(database, 'SELECT user_id FROM player_controllers')).toEqual([]);
    });

    it('allows six players and refuses the seventh', async () => {
      for (let index = 1; index <= 5; index += 1) seedPlayer(database, `seed${index}`, 'lobby');
      expect(await join('u1', 'sixth')).toBe(true);
      expect(await join('u2', 'seventh')).toBe(false);
      expect(rows(database, 'SELECT id FROM players')).toHaveLength(6);
      expect(await repository.getRole('lobby', 'u2')).toBeNull();
    });
  });

  describe('removeLobbyPlayer', () => {
    it('removes a joined player with their membership and control', async () => {
      await join('u1', 'p1');
      expect(await repository.removeLobbyPlayer('lobby', 'p1')).toBe(true);
      expect(rows(database, 'SELECT id FROM players')).toEqual([]);
      expect(rows(database, 'SELECT user_id FROM game_members')).toEqual([]);
      expect(rows(database, 'SELECT user_id FROM player_controllers')).toEqual([]);
    });

    it('keeps the owner player and everything linked to it', async () => {
      seedPlayer(database, 'op', 'lobby');
      await repository.addMember('lobby', 'owner', 'OWNER', 'op');
      expect(await repository.removeLobbyPlayer('lobby', 'op')).toBe(false);
      expect(rows(database, 'SELECT id FROM players')).toHaveLength(1);
      expect(rows(database, 'SELECT user_id FROM game_members')).toHaveLength(1);
    });

    it('refuses once the game is running or the player is unknown', async () => {
      await join('u1', 'p1');
      exec(database, "UPDATE games SET status = 'ACTIVE' WHERE id = 'lobby'");
      expect(await repository.removeLobbyPlayer('lobby', 'p1')).toBe(false);
      expect(rows(database, 'SELECT id FROM players')).toHaveLength(1);
      expect(rows(database, 'SELECT user_id FROM game_members')).toHaveLength(1);
      expect(rows(database, 'SELECT user_id FROM player_controllers')).toHaveLength(1);
      exec(database, "UPDATE games SET status = 'LOBBY' WHERE id = 'lobby'");
      expect(await repository.removeLobbyPlayer('lobby', 'ghost')).toBe(false);
      expect(await repository.removeLobbyPlayer('other', 'p1')).toBe(false);
    });
  });

  describe('access credentials', () => {
    it('finds a game by trimmed, case-insensitive join code', async () => {
      exec(
        database,
        "UPDATE games SET game_access_password_hash = 'h', game_access_password_salt = 's' WHERE id = 'lobby'",
      );
      expect(await repository.getGameAccessCredentials('  code1234 ')).toEqual({
        gameId: 'lobby',
        passwordHash: 'h',
        passwordSalt: 's',
        status: 'LOBBY',
      });
    });

    it('returns null credentials for open games, and nothing for unknown, ownerless or deleted games', async () => {
      expect(await repository.getGameAccessCredentials('CODE1234')).toEqual({
        gameId: 'lobby',
        passwordHash: null,
        passwordSalt: null,
        status: 'LOBBY',
      });
      expect(await repository.getGameAccessCredentials('NOPE')).toBeNull();
      exec(database, "UPDATE games SET deleted_at = '2026-01-01' WHERE id = 'lobby'");
      expect(await repository.getGameAccessCredentials('CODE1234')).toBeNull();
      seedGame(database, 'ownerless', { owner: null, joinCode: 'NOOWNER1' });
      expect(await repository.getGameAccessCredentials('NOOWNER1')).toBeNull();
    });

    it('shows the join code to the owner only', async () => {
      await repository.addMember('lobby', 'owner', 'OWNER');
      await repository.addMember('lobby', 'u1', 'PLAYER');
      expect(await repository.getOwnerJoinCode('lobby', 'owner')).toBe('CODE1234');
      expect(await repository.getOwnerJoinCode('lobby', 'u1')).toBeNull();
      expect(await repository.getOwnerJoinCode('lobby', 'u2')).toBeNull();
    });

    it('reports whether a game has an access password', async () => {
      expect(await repository.hasAccessPassword('lobby')).toBe(false);
      expect(await repository.hasAccessPassword('ghost')).toBe(false);
      exec(database, "UPDATE games SET game_access_password_hash = 'h' WHERE id = 'lobby'");
      expect(await repository.hasAccessPassword('lobby')).toBe(true);
    });
  });

  describe('invitations', () => {
    const invite = (tokenHash: string, shortCode: string, gameId = 'lobby', expiresAt = future) =>
      repository.createInvitation({
        gameId,
        ownerUserId: 'owner',
        tokenHash,
        shortCode,
        expiresAt,
        visibility: 'UNLISTED',
      });

    it('creates an invitation that can be found until it expires', async () => {
      expect(await invite('t1', 'S1')).toBe(true);
      expect(await repository.findInvitation('t1')).toEqual({ gameId: 'lobby', status: 'LOBBY' });
      expect(await repository.findInvitation('unknown')).toBeNull();
      exec(database, "UPDATE game_invitations SET expires_at = '2000-01-01T00:00:00.000Z'");
      expect(await repository.findInvitation('t1')).toBeNull();
    });

    it('replaces the previous active invitation of the owner', async () => {
      await invite('t1', 'S1');
      expect(await invite('t2', 'S2')).toBe(true);
      expect(await repository.findInvitation('t1')).toBeNull();
      expect(await repository.findInvitation('t2')).not.toBeNull();
      expect(
        rows<{ revoked_at: string | null }>(
          database,
          "SELECT revoked_at FROM game_invitations WHERE token_hash = 't1'",
        )[0].revoked_at,
      ).not.toBeNull();
    });

    it('does not create an invitation for a game that has started', async () => {
      exec(database, "UPDATE games SET status = 'ACTIVE' WHERE id = 'lobby'");
      expect(await invite('t1', 'S1')).toBe(false);
      expect(rows(database, 'SELECT token_hash FROM game_invitations')).toEqual([]);
    });

    it('revokes active invitations of the owner while in the lobby only', async () => {
      await invite('t1', 'S1');
      expect(await repository.revokeInvitations('lobby', 'u1')).toBe(false);
      expect(await repository.revokeInvitations('lobby', 'owner')).toBe(true);
      expect(await repository.findInvitation('t1')).toBeNull();
      expect(await repository.revokeInvitations('lobby', 'owner')).toBe(false);
      await invite('t2', 'S2');
      exec(database, "UPDATE games SET status = 'ACTIVE' WHERE id = 'lobby'");
      expect(await repository.revokeInvitations('lobby', 'owner')).toBe(false);
      expect(await repository.findInvitation('t2')).not.toBeNull();
    });
  });

  describe('player controllers', () => {
    it('lists the primary control before local ones and checks control per player', async () => {
      seedPlayer(database, 'p1', 'lobby');
      seedPlayer(database, 'p2', 'lobby');
      seedPlayer(database, 'p3', 'lobby');
      exec(
        database,
        "INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES ('lobby', 'p1', 'u1', 'LOCAL')",
      );
      exec(
        database,
        "INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES ('lobby', 'p2', 'u1', 'PRIMARY')",
      );
      expect(await repository.listPlayerControllers('lobby', 'u1')).toEqual([
        { playerId: 'p2', kind: 'PRIMARY' },
        { playerId: 'p1', kind: 'LOCAL' },
      ]);
      expect(await repository.listPlayerControllers('lobby', 'u2')).toEqual([]);
      expect(await repository.isPlayerControlledBy('lobby', 'u1', 'p1')).toBe(true);
      expect(await repository.isPlayerControlledBy('lobby', 'u1', 'p3')).toBe(false);
      expect(await repository.isPlayerControlledBy('lobby', 'u2', 'p1')).toBe(false);
      expect(await repository.isPlayerControlledBy('other', 'u1', 'p1')).toBe(false);
    });
  });
});
