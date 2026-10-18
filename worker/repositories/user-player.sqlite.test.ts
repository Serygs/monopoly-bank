// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../services/errors.js';
import { D1PlayerRepository } from './player-repository.js';
import { D1UserRepository, type CreateUserInput } from './user-repository.js';
import {
  d1,
  exec,
  failingD1,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

function newUser(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
  return {
    id: 'u1',
    nickname: 'Alice',
    avatar: 'a.png',
    accountType: 'REGISTERED',
    email: 'alice@example.com',
    normalizedEmail: 'alice@example.com',
    emailVerifiedAt: null,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    ...overrides,
  };
}

describe('D1UserRepository', () => {
  let database: DatabaseSync;
  let repository: D1UserRepository;

  beforeEach(async () => {
    database = await migrated();
    repository = new D1UserRepository(d1(database));
  });

  it('creates a user and returns the mapped record with zeroed statistics', async () => {
    const user = await repository.create(newUser({ emailVerifiedAt: '2026-01-01T00:00:00.000Z' }));
    expect(user).toMatchObject({
      id: 'u1',
      nickname: 'Alice',
      avatar: 'a.png',
      accountType: 'REGISTERED',
      email: 'alice@example.com',
      normalizedEmail: 'alice@example.com',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      passwordHash: 'hash',
      passwordSalt: 'salt',
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
    });
    expect(user.createdAt).not.toBe('');
    expect(user.updatedAt).not.toBe('');
  });

  it('reports a taken nickname or email as an unavailable identifier', async () => {
    await repository.create(newUser());
    for (const clash of [
      { id: 'u2', normalizedEmail: 'other@example.com' },
      { id: 'u3', nickname: 'Bob' },
    ]) {
      const attempt = repository.create(newUser(clash));
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({
        code: 'ACCOUNT_IDENTIFIER_UNAVAILABLE',
        status: 409,
      });
    }
  });

  it('wraps unexpected creation failures', async () => {
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).create(newUser()),
    ).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      operation: 'createUser',
    });
  });

  it('finds users by nickname, email and id', async () => {
    await repository.create(newUser());
    expect((await repository.findByNickname('Alice'))?.id).toBe('u1');
    expect(await repository.findByNickname('alice')).toBeNull();
    expect((await repository.findByNormalizedEmail('alice@example.com'))?.id).toBe('u1');
    expect(await repository.findByNormalizedEmail('nobody@example.com')).toBeNull();
    expect((await repository.findById('u1'))?.nickname).toBe('Alice');
    expect(await repository.findById('ghost')).toBeNull();
  });

  it('wraps lookup failures with the operation name', async () => {
    const failing = new D1UserRepository(failingD1(new Error('io')));
    await expect(failing.findByNickname('a')).rejects.toMatchObject({
      operation: 'findUserByNickname',
    });
    await expect(failing.findByNormalizedEmail('a')).rejects.toMatchObject({
      operation: 'findUserByEmail',
    });
    await expect(failing.findById('a')).rejects.toMatchObject({ operation: 'findUserById' });
    await expect(failing.findByLoginNickname('a')).rejects.toMatchObject({
      operation: 'findUserByNickname',
    });
  });

  it('logs in by exact nickname before any case-insensitive match', async () => {
    await repository.create(
      newUser({ id: 'u1', nickname: 'Alice', normalizedEmail: 'a1@x.y', email: 'a1@x.y' }),
    );
    await repository.create(
      newUser({ id: 'u2', nickname: 'ALICE', normalizedEmail: 'a2@x.y', email: 'a2@x.y' }),
    );
    expect((await repository.findByLoginNickname('ALICE'))?.id).toBe('u2');
  });

  it('falls back to a single case-insensitive registered match', async () => {
    await repository.create(newUser());
    expect((await repository.findByLoginNickname('aLiCe'))?.id).toBe('u1');
    expect(await repository.findByLoginNickname('nobody')).toBeNull();
  });

  it('refuses an ambiguous case-insensitive match and never matches guests', async () => {
    await repository.create(
      newUser({ id: 'u1', nickname: 'Bob', normalizedEmail: 'b1@x.y', email: 'b1@x.y' }),
    );
    await repository.create(
      newUser({ id: 'u2', nickname: 'BOB', normalizedEmail: 'b2@x.y', email: 'b2@x.y' }),
    );
    expect(await repository.findByLoginNickname('bob')).toBeNull();
    await repository.create(
      newUser({
        id: 'u3',
        nickname: 'Guesty',
        accountType: 'GUEST',
        email: null,
        normalizedEmail: null,
      }),
    );
    expect(await repository.findByLoginNickname('guesty')).toBeNull();
    expect((await repository.findByLoginNickname('Guesty'))?.id).toBe('u3');
  });

  it('updates the profile and reports unknown users and clashes', async () => {
    await repository.create(newUser());
    await repository.create(
      newUser({ id: 'u2', nickname: 'Bob', email: 'b@x.y', normalizedEmail: 'b@x.y' }),
    );
    const updated = await repository.updateProfile('u1', 'Alice2', 'new.png');
    expect(updated).toMatchObject({ id: 'u1', nickname: 'Alice2', avatar: 'new.png' });
    expect(await repository.updateProfile('ghost', 'x', 'y')).toBeNull();
    await expect(repository.updateProfile('u1', 'Bob', 'a')).rejects.toMatchObject({
      code: 'ACCOUNT_IDENTIFIER_UNAVAILABLE',
    });
  });

  it('marks the email verified once and only for registered accounts', async () => {
    await repository.create(newUser());
    await repository.create(
      newUser({
        id: 'g',
        nickname: 'Guest',
        accountType: 'GUEST',
        email: null,
        normalizedEmail: null,
      }),
    );
    const first = await repository.markEmailVerified('u1');
    expect(first?.emailVerifiedAt).not.toBeNull();
    exec(database, "UPDATE users SET email_verified_at = '2001-01-01 00:00:00' WHERE id = 'u1'");
    expect((await repository.markEmailVerified('u1'))?.emailVerifiedAt).toBe('2001-01-01 00:00:00');
    expect(await repository.markEmailVerified('g')).toBeNull();
    expect(await repository.markEmailVerified('ghost')).toBeNull();
  });

  it('changes the password credentials only for the given user', async () => {
    await repository.create(newUser());
    await repository.create(
      newUser({ id: 'u2', nickname: 'Bob', email: 'b@x.y', normalizedEmail: 'b@x.y' }),
    );
    const changed = await repository.changePassword('u1', 'h2', 's2');
    expect(changed).toMatchObject({ id: 'u1', passwordHash: 'h2', passwordSalt: 's2' });
    expect((await repository.findById('u2'))?.passwordHash).toBe('hash');
    expect(await repository.changePassword('ghost', 'h', 's')).toBeNull();
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).changePassword('u1', 'h', 's'),
    ).rejects.toMatchObject({
      operation: 'changePassword',
    });
  });

  it('upgrades a guest to a registered account', async () => {
    await repository.create(
      newUser({
        id: 'g',
        nickname: 'Guest',
        accountType: 'GUEST',
        email: null,
        normalizedEmail: null,
      }),
    );
    await repository.create(newUser());
    const input = {
      id: 'g',
      email: 'g@x.y',
      normalizedEmail: 'g@x.y',
      passwordHash: 'gh',
      passwordSalt: 'gs',
    };
    expect(await repository.upgradeGuest(input)).toMatchObject({
      id: 'g',
      accountType: 'REGISTERED',
      email: 'g@x.y',
      normalizedEmail: 'g@x.y',
      emailVerifiedAt: null,
      passwordHash: 'gh',
      passwordSalt: 'gs',
    });
    expect(await repository.upgradeGuest(input)).toBeNull();
    expect(await repository.upgradeGuest({ ...input, id: 'u1' })).toBeNull();
    expect(await repository.upgradeGuest({ ...input, id: 'ghost' })).toBeNull();
  });

  it('refuses to upgrade a guest to an email that is taken', async () => {
    await repository.create(
      newUser({
        id: 'g',
        nickname: 'Guest',
        accountType: 'GUEST',
        email: null,
        normalizedEmail: null,
      }),
    );
    await repository.create(newUser());
    await expect(
      repository.upgradeGuest({
        id: 'g',
        email: 'alice@example.com',
        normalizedEmail: 'alice@example.com',
        passwordHash: 'h',
        passwordSalt: 's',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_IDENTIFIER_UNAVAILABLE' });
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).upgradeGuest({
        id: 'g',
        email: 'e',
        normalizedEmail: 'e',
        passwordHash: 'h',
        passwordSalt: 's',
      }),
    ).rejects.toMatchObject({ operation: 'upgradeGuest' });
  });

  it('adds an email only to a registered account that has none', async () => {
    await repository.create(
      newUser({
        id: 'legacy',
        nickname: 'Legacy',
        email: null,
        normalizedEmail: null,
        emailVerifiedAt: '2001-01-01',
      }),
    );
    await repository.create(newUser());
    await repository.create(
      newUser({
        id: 'g',
        nickname: 'Guest',
        accountType: 'GUEST',
        email: null,
        normalizedEmail: null,
      }),
    );
    expect(await repository.addEmailToLegacyAccount('legacy', 'L@x.y', 'l@x.y')).toMatchObject({
      id: 'legacy',
      email: 'L@x.y',
      normalizedEmail: 'l@x.y',
      emailVerifiedAt: null,
    });
    expect(await repository.addEmailToLegacyAccount('legacy', 'z@x.y', 'z@x.y')).toBeNull();
    expect(await repository.addEmailToLegacyAccount('u1', 'z@x.y', 'z@x.y')).toBeNull();
    expect(await repository.addEmailToLegacyAccount('g', 'z@x.y', 'z@x.y')).toBeNull();
    expect(await repository.addEmailToLegacyAccount('ghost', 'z@x.y', 'z@x.y')).toBeNull();
  });

  it('reports a duplicate email on a legacy account and wraps other failures', async () => {
    await repository.create(newUser());
    await repository.create(
      newUser({ id: 'legacy', nickname: 'Legacy', email: null, normalizedEmail: null }),
    );
    await expect(
      repository.addEmailToLegacyAccount('legacy', 'alice@example.com', 'alice@example.com'),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_IDENTIFIER_UNAVAILABLE',
    });
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).addEmailToLegacyAccount('l', 'e', 'e'),
    ).rejects.toMatchObject({
      operation: 'addLegacyAccountEmail',
    });
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).markEmailVerified('l'),
    ).rejects.toMatchObject({
      operation: 'markEmailVerified',
    });
    await expect(
      new D1UserRepository(failingD1(new Error('io'))).updateProfile('l', 'n', 'a'),
    ).rejects.toMatchObject({
      operation: 'updateUserProfile',
    });
  });
});

describe('D1PlayerRepository', () => {
  let database: DatabaseSync;
  let repository: D1PlayerRepository;

  beforeEach(async () => {
    database = await migrated();
    repository = new D1PlayerRepository(d1(database));
    seedUser(database, 'owner');
    seedGame(database, 'g1', { owner: 'owner' });
    seedGame(database, 'g2', { owner: 'owner' });
  });

  it('creates nothing for an empty list', async () => {
    expect(await repository.createMany([])).toEqual([]);
    expect(rows(database, 'SELECT id FROM players')).toEqual([]);
  });

  it('creates players of one game and lists them with defaults, ordered by id on ties', async () => {
    const created = await repository.createMany([
      { id: 'b', gameId: 'g1', name: 'Bea', color: '#111', balance: 1500 },
      { id: 'a', gameId: 'g1', name: 'Al', color: '#222', balance: 900 },
    ]);
    expect(created.map((player) => player.id)).toEqual(['a', 'b']);
    expect(created[0]).toMatchObject({
      gameId: 'g1',
      name: 'Al',
      color: '#222',
      balance: 900,
      status: 'ACTIVE',
      isInJail: false,
      consecutiveDoubles: 0,
      userId: null,
    });
    expect(created[0].createdAt).not.toBe('');
  });

  it('rejects players of different games without writing any', async () => {
    await expect(
      repository.createMany([
        { id: 'a', gameId: 'g1', name: 'A', color: '#1', balance: 1 },
        { id: 'b', gameId: 'g2', name: 'B', color: '#2', balance: 1 },
      ]),
    ).rejects.toThrow('Players created together must belong to the same game.');
    expect(rows(database, 'SELECT id FROM players')).toEqual([]);
  });

  it('rolls the whole batch back when one player is invalid', async () => {
    await expect(
      repository.createMany([
        { id: 'a', gameId: 'g1', name: 'A', color: '#1', balance: 10 },
        { id: 'b', gameId: 'g1', name: 'B', color: '#2', balance: -1 },
      ]),
    ).rejects.toThrow();
    expect(rows(database, 'SELECT id FROM players')).toEqual([]);
  });

  it('lists only the players of the game and exposes the linked user', async () => {
    seedPlayer(database, 'p1', 'g1');
    seedPlayer(database, 'p2', 'g1');
    seedPlayer(database, 'other', 'g2');
    seedUser(database, 'u1');
    exec(
      database,
      "INSERT INTO game_members (game_id, user_id, role, player_id) VALUES ('g1', 'u1', 'PLAYER', 'p2')",
    );
    const players = await repository.listByGameId('g1');
    expect(players.map((player) => [player.id, player.userId])).toEqual([
      ['p1', null],
      ['p2', 'u1'],
    ]);
    expect(await repository.listByGameId('missing')).toEqual([]);
  });

  it('updates a balance, including down to zero, and refuses a negative one', async () => {
    seedPlayer(database, 'p1', 'g1', 100);
    expect(await repository.updateBalance('p1', 250)).toBe(true);
    expect(await repository.updateBalance('p1', 0)).toBe(true);
    expect(rows<{ balance: number }>(database, 'SELECT balance FROM players')[0].balance).toBe(0);
    expect(await repository.updateBalance('p1', -1)).toBe(false);
    expect(rows<{ balance: number }>(database, 'SELECT balance FROM players')[0].balance).toBe(0);
    expect(await repository.updateBalance('ghost', 5)).toBe(false);
  });

  it('updates only the provided gameplay fields and returns the player', async () => {
    seedPlayer(database, 'p1', 'g1', 700);
    expect(await repository.updateGameplayState('p1', { isInJail: true })).toMatchObject({
      id: 'p1',
      isInJail: true,
      status: 'ACTIVE',
      consecutiveDoubles: 0,
      balance: 700,
      userId: null,
    });
    expect(await repository.updateGameplayState('p1', { consecutiveDoubles: 2 })).toMatchObject({
      isInJail: true,
      consecutiveDoubles: 2,
    });
    expect(
      await repository.updateGameplayState('p1', { isInJail: false, status: 'BANKRUPT' }),
    ).toMatchObject({
      isInJail: false,
      status: 'BANKRUPT',
      consecutiveDoubles: 2,
    });
    expect(await repository.updateGameplayState('p1', { consecutiveDoubles: 0 })).toMatchObject({
      consecutiveDoubles: 0,
    });
  });

  it('returns null without writing for an empty update or unknown player', async () => {
    seedPlayer(database, 'p1', 'g1');
    expect(await repository.updateGameplayState('p1', {})).toBeNull();
    expect(await repository.updateGameplayState('ghost', { isInJail: true })).toBeNull();
    expect(
      rows<{ is_in_jail: number }>(database, 'SELECT is_in_jail FROM players')[0].is_in_jail,
    ).toBe(0);
  });
});
