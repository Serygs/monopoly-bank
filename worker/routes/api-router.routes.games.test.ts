import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api.js';
import { ForbiddenError, GameOwnerRequiredError } from '../services/errors.js';
import {
  G,
  P1,
  P2,
  T,
  CMD,
  USER,
  details,
  harness,
  request,
  read,
  withCommand,
} from '../test-support/api-router-harness.js';

describe('game list and detail routes', () => {
  it('lists the games and deleted games of the signed-in user', async () => {
    const { router, m } = harness();
    m.games.listGamesForUser.mockResolvedValue([{ id: G }]);
    m.games.listDeletedGamesForUser.mockResolvedValue([{ id: 'x' }]);
    expect(await read(await router(request('GET', '/api/games')))).toEqual({ data: [{ id: G }] });
    expect(m.games.listGamesForUser).toHaveBeenCalledWith(USER.id);
    expect(await read(await router(request('GET', '/api/games/deleted')))).toEqual({
      data: [{ id: 'x' }],
    });
    expect(m.games.listDeletedGamesForUser).toHaveBeenCalledWith(USER.id);
  });

  it('creates a game with 201 for the signed-in owner', async () => {
    const { router, m } = harness();
    m.games.createGameForOwner.mockResolvedValue(details());
    const response = await router(
      request('POST', '/api/games', {
        name: 'Table',
        startingBalance: 1500,
        passGoReward: 200,
        currency: 'USD',
        players: [{ name: 'Ada', color: '#fff' }],
      }),
    );
    expect(response.status).toBe(201);
    expect(m.games.createGameForOwner).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ name: 'Table' }),
    );
    expect((await router(request('PUT', '/api/games', {}))).status).toBe(404);
  });

  it('shows a player the game with their wallets and no owner fields', async () => {
    const { router } = harness();
    const body = (await read(await router(request('GET', `/api/games/${G}`)))).data as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      controlledWallets: [{ playerId: P1 }, { playerId: P2 }],
      controlledPlayerIds: [P1, P2],
      canManage: false,
    });
    expect(body).not.toHaveProperty('joinCode');
    expect(body).not.toHaveProperty('hasAccessPassword');
    expect(body).not.toHaveProperty('tradeRequests');
  });

  it('shows the owner the join code and whether a password is set', async () => {
    const { router, m, requireMember } = harness();
    requireMember.mockResolvedValue('OWNER');
    m.access.ownerJoinCode.mockResolvedValue('ABCD12');
    m.access.hasAccessPassword.mockResolvedValue(true);
    const body = (await read(await router(request('GET', `/api/games/${G}`)))).data as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ canManage: true, joinCode: 'ABCD12', hasAccessPassword: true });
    expect(m.access.ownerJoinCode).toHaveBeenCalledWith(G, USER.id);
  });

  it('adds the pending trades of the player’s wallets for a board game only', async () => {
    const { router, m } = harness();
    const board = {
      ...details(),
      game: { ...details().game, settings: { board: { tiles: [] } } },
    } as unknown as GameDetails;
    m.games.getGame.mockResolvedValue(board);
    m.banking.listTradeRequests.mockResolvedValue([{ id: T }]);
    const body = (await read(await router(request('GET', `/api/games/${G}`)))).data as Record<
      string,
      unknown
    >;
    expect(body.tradeRequests).toEqual([{ id: T }]);
    expect(m.banking.listTradeRequests).toHaveBeenCalledWith(G, [P1, P2]);
  });

  it('refuses a game id that is not a UUID and a user who is not a member', async () => {
    const { router, requireMember } = harness();
    const bad = await router(request('GET', '/api/games/not-a-uuid'));
    expect(bad.status).toBe(400);
    expect(await read(bad)).toMatchObject({ error: { message: 'gameId must be a UUID.' } });
    requireMember.mockRejectedValue(new ForbiddenError());
    expect((await router(request('GET', `/api/games/${G}`))).status).toBe(403);
  });

  it('deletes and restores a game as its owner', async () => {
    const { router, m } = harness();
    m.games.deleteGame.mockResolvedValue({ gameId: G });
    m.games.restoreGame.mockResolvedValue({ gameId: G });
    expect(await read(await router(request('DELETE', `/api/games/${G}`)))).toEqual({
      data: { gameId: G },
    });
    expect(m.access.requireOwner).toHaveBeenCalledWith(G, USER.id);
    expect(m.games.deleteGame).toHaveBeenCalledWith(G);
    await router(request('POST', `/api/games/${G}/restore`));
    expect(m.games.restoreGame).toHaveBeenCalledWith(G, USER.id);
  });

  it('keeps an owner check in front of delete, invitations, start and duplicate', async () => {
    const { router, m } = harness();
    m.access.requireOwner.mockRejectedValue(new GameOwnerRequiredError());
    for (const [method, path, body] of [
      ['DELETE', `/api/games/${G}`, undefined],
      ['POST', `/api/games/${G}/invitations`, undefined],
      ['DELETE', `/api/games/${G}/invitations`, undefined],
      ['POST', `/api/games/${G}/start`, undefined],
      ['POST', `/api/games/${G}/duplicate`, { gameAccessPassword: 'abcd' }],
      ['POST', `/api/games/${G}/finish`, { winnerPlayerIds: [] }],
      ['DELETE', `/api/games/${G}/players/${P1}`, undefined],
    ] as const) {
      const response = await router(request(method, path, body, withCommand));
      expect(response.status).toBe(403);
      expect((await read(response)).error?.code).toBe('GAME_OWNER_REQUIRED');
    }
    expect(m.games.deleteGame).not.toHaveBeenCalled();
    expect(m.games.startGame).not.toHaveBeenCalled();
  });

  it('creates and revokes invitations', async () => {
    const { router, m } = harness();
    m.access.createInvitation.mockResolvedValue({ token: 'x' });
    const created = await router(request('POST', `/api/games/${G}/invitations`));
    expect(created.status).toBe(201);
    expect(await read(created)).toEqual({ data: { token: 'x' } });
    expect(m.access.createInvitation).toHaveBeenCalledWith(G, USER.id);
    const revoked = await router(request('DELETE', `/api/games/${G}/invitations`));
    expect(await read(revoked)).toEqual({ data: { revoked: true } });
    expect(m.access.revokeInvitations).toHaveBeenCalledWith(G, USER.id);
  });

  it('regenerates the join code for the owner only and leaves no code in the audit event', async () => {
    const { router, m, requireMember } = harness();
    requireMember.mockResolvedValue('PLAYER');
    const refused = await router(request('POST', `/api/games/${G}/join-code/regenerate`));
    expect(refused.status).toBe(403);
    expect(m.games.regenerateJoinCode).not.toHaveBeenCalled();
    requireMember.mockResolvedValue('OWNER');
    m.games.regenerateJoinCode.mockResolvedValue({ joinCode: 'NEW123' });
    const done = await router(request('POST', `/api/games/${G}/join-code/regenerate`));
    expect(await read(done)).toEqual({ data: { joinCode: 'NEW123' } });
    expect(m.games.regenerateJoinCode).toHaveBeenCalledWith(G, USER.id);
  });

  it('duplicates a game for its owner with the table password and answers 201', async () => {
    const { router, m } = harness();
    const response = await router(
      request('POST', `/api/games/${G}/duplicate`, { gameAccessPassword: 'abcd' }),
    );
    expect(response.status).toBe(201);
    expect(m.games.duplicateGameForOwner).toHaveBeenCalledWith(USER.id, G, 'abcd');
  });

  it('removes a lobby player directly or through the live game', async () => {
    const direct = harness();
    direct.m.games.getGame.mockResolvedValue(details());
    const done = await direct.router(request('DELETE', `/api/games/${G}/players/${P1}`));
    expect(direct.m.access.removeLobbyPlayer).toHaveBeenCalledWith(G, USER.id, P1);
    expect(await read(done)).toEqual({ data: details() });
    const live = harness({ live: true });
    await live.router(request('DELETE', `/api/games/${G}/players/${P1}`, undefined, withCommand));
    expect(live.m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'REMOVE_PLAYER',
      commandId: CMD,
      playerId: P1,
    });
    expect(live.m.access.removeLobbyPlayer).not.toHaveBeenCalled();
  });

  it('starts a game directly or through the live game', async () => {
    const direct = harness();
    direct.m.games.startGame.mockResolvedValue(details());
    await direct.router(request('POST', `/api/games/${G}/start`));
    expect(direct.m.games.startGame).toHaveBeenCalledWith(G);
    const live = harness({ live: true });
    await live.router(request('POST', `/api/games/${G}/start`, undefined, withCommand));
    expect(live.m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'START_GAME',
      commandId: CMD,
    });
    expect(live.m.games.startGame).not.toHaveBeenCalled();
  });

  it('stores a favourite amount for a member and refuses anything but a positive integer', async () => {
    const { router, m } = harness();
    m.games.toggleFavoriteAmount.mockResolvedValue([50]);
    const ok = await router(request('POST', `/api/games/${G}/favorite-amounts`, { amount: 50 }));
    expect(await read(ok)).toEqual({ data: [50] });
    expect(m.games.toggleFavoriteAmount).toHaveBeenCalledWith(G, 50);
    for (const amount of [0, -1, 1.5, '5', null, Number.MAX_SAFE_INTEGER + 1]) {
      const refused = await router(request('POST', `/api/games/${G}/favorite-amounts`, { amount }));
      expect(refused.status).toBe(400);
      expect(await read(refused)).toMatchObject({
        error: { message: 'amount must be a positive integer.' },
      });
    }
  });
});

describe('joining a game', () => {
  const join = (body: unknown, path = '/api/games/join') =>
    request('POST', path, body, withCommand);

  it('refuses a code that matches nothing, a wrong password and a game that already started', async () => {
    const { router, m } = harness();
    m.access.getJoinCredentials.mockResolvedValue(null);
    const unknown = await router(join({ joinCode: 'ABCD' }));
    expect(unknown.status).toBe(404);
    expect((await read(unknown)).error?.code).toBe('INVALID_JOIN_CODE');
    m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'LOBBY' });
    m.access.verifyGamePassword.mockResolvedValue(false);
    expect(
      (await read(await router(join({ joinCode: 'ABCD', gameAccessPassword: 'nope1' })))).error
        ?.code,
    ).toBe('INVALID_JOIN_CODE');
    m.access.verifyGamePassword.mockResolvedValue(true);
    m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'ACTIVE' });
    const closed = await router(join({ joinCode: 'ABCD' }));
    expect(closed.status).toBe(409);
    expect((await read(closed)).error?.code).toBe('LOBBY_CLOSED');
  });

  it('looks the code up in its normal form and passes the password to the check', async () => {
    const { router, m } = harness();
    await router(join({ joinCode: ' ab12 ', gameAccessPassword: 'abcd' }));
    expect(m.access.getJoinCredentials).toHaveBeenCalledWith('AB12');
    expect(m.access.verifyGamePassword).toHaveBeenCalledWith('abcd', {
      gameId: G,
      status: 'LOBBY',
    });
  });

  it('seats a player directly in a colour nobody at the table has', async () => {
    const { router, m } = harness();
    const response = await router(join({ joinCode: 'ABCD' }));
    expect(response.status).toBe(200);
    expect(m.access.requireLobbySeat).toHaveBeenCalledWith(G, USER.id, 2);
    const joined = m.access.joinLobby.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(joined).toMatchObject({
      gameId: G,
      userId: USER.id,
      nickname: 'Test',
      startingBalance: 1500,
    });
    expect(['#238b57', '#d97721', '#8b4cc5', '#087f78']).toContain(joined.color);
    expect(joined.playerId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('seats a player through the live game with the command id', async () => {
    const { router, m } = harness({ live: true });
    await router(join({ joinCode: 'ABCD' }));
    expect(m.live.mutate).toHaveBeenCalledWith(
      G,
      USER,
      expect.objectContaining({
        type: 'JOIN_LOBBY',
        commandId: CMD,
        nickname: 'Test',
        startingBalance: 1500,
      }),
    );
    expect(m.access.joinLobby).not.toHaveBeenCalled();
  });

  it('joins with an invitation token and does not count it as a failed guess', async () => {
    const { router, m } = harness();
    m.access.invitation.mockResolvedValue(null);
    const refused = await router(join({ invitationToken: 'a'.repeat(32) }));
    expect(refused.status).toBe(404);
    expect(m.access.invitation).toHaveBeenCalledWith('a'.repeat(32));
    expect(m.access.getJoinCredentials).not.toHaveBeenCalled();
  });

  it('refuses a guest when the lobby is full, and creates a guest account otherwise', async () => {
    const { router, m } = harness();
    const full = details();
    full.players = Array.from({ length: 6 }, (_, index) => ({
      ...(full.players[0] as GameDetails['players'][number]),
      id: `00000000-0000-4000-8000-0000000001${index}0`,
      color: `#00000${index}`,
    }));
    m.games.getGame.mockResolvedValue(full);
    const refused = await router(
      join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
    );
    expect(refused.status).toBe(409);
    expect((await read(refused)).error?.code).toBe('LOBBY_FULL');
    expect(m.auth.createGuest).not.toHaveBeenCalled();
    m.games.getGame.mockResolvedValue(details());
    const joined = await router(
      join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
    );
    expect(joined.status).toBe(201);
    expect(joined.headers.get('set-cookie')).toBe('guest=1');
    expect(m.auth.createGuest).toHaveBeenCalledWith('Ann', '🙂');
    expect(await read(joined)).toMatchObject({ data: { profile: USER, game: details() } });
  });

  it('seats a guest through the live game and returns the game it gives back', async () => {
    const { router, m } = harness({ live: true });
    const joined = await router(
      join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
    );
    expect(joined.status).toBe(201);
    expect(await read(joined)).toEqual({ data: { profile: USER, game: { live: 'mutated' } } });
    m.live.mutate.mockImplementation(async () =>
      Response.json({ error: { code: 'LOBBY_FULL' } }, { status: 409 }),
    );
    const failed = await router(
      join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
    );
    expect(failed.status).toBe(409);
  });

  it('refuses a guest for a game that already started or for an unknown code', async () => {
    const { router, m } = harness();
    m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'ACTIVE' });
    expect(
      (
        await read(
          await router(
            join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
          ),
        )
      ).error?.code,
    ).toBe('LOBBY_CLOSED');
    m.access.getJoinCredentials.mockResolvedValue(null);
    expect(
      (
        await read(
          await router(
            join({ nickname: 'Ann', avatar: '🙂', joinCode: 'ABCD' }, '/api/games/join/guest'),
          ),
        )
      ).error?.code,
    ).toBe('INVALID_JOIN_CODE');
  });
});
