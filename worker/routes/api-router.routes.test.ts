import { describe, expect, it, vi, type Mock } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api.js';
import { ForbiddenError, GameOwnerRequiredError } from '../services/errors.js';
import { createApiRouter, type ApiRouterDependencies } from './api-router.js';

const G = '00000000-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-000000000002';
const P2 = '00000000-0000-4000-8000-000000000003';
const R = '00000000-0000-4000-8000-0000000000a1';
const T = '00000000-0000-4000-8000-0000000000b1';
const CMD = '00000000-0000-4000-8000-0000000000c1';
const USER = {
  id: '00000000-0000-4000-8000-000000000099',
  nickname: 'Test',
  avatar: '🧩',
  gamesPlayed: 0,
  gamesWon: 0,
  winRate: 0,
  createdAt: '',
  updatedAt: '',
};

const details = (patch: Partial<GameDetails['game']> = {}): GameDetails => ({
  game: {
    id: G,
    name: 'Table',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: {
      doubleRewardOnExactGo: false,
      playerLoans: false,
      bankLoans: false,
      freeParkingJackpot: false,
      auctions: false,
    },
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
    ...patch,
  },
  players: [
    { id: P1, gameId: G, name: 'Ada', color: '#e05263', balance: 1500, createdAt: '' },
    { id: P2, gameId: G, name: 'Lin', color: '#2f80ed', balance: 1500, createdAt: '' },
  ],
});

type Fn = Mock<(...args: unknown[]) => unknown>;
const fns = (...names: string[]): Record<string, Fn> =>
  Object.fromEntries(names.map((name) => [name, vi.fn(async () => ({ name }))]));

function harness(options: { live?: boolean; statistics?: boolean; dice?: boolean } = {}) {
  const live = options.live ?? false;
  const m = {
    games: fns(
      'listGamesForUser',
      'createGameForOwner',
      'getGame',
      'deleteGame',
      'listDeletedGamesForUser',
      'restoreGame',
      'regenerateJoinCode',
      'duplicateGameForOwner',
      'startGame',
      'finishGame',
      'toggleFavoriteAmount',
    ),
    banking: fns(
      'createTransaction',
      'listTransactions',
      'listPlayerTransactions',
      'getTransaction',
      'declareBankruptcy',
      'listPaymentRequests',
      'getPaymentRequest',
      'acceptPaymentRequest',
      'declinePaymentRequest',
      'cancelPaymentRequest',
      'listTradeRequests',
      'getTradeRequest',
      'createTradeRequest',
      'acceptTradeRequest',
      'declineTradeRequest',
      'cancelTradeRequest',
    ),
    auth: fns(
      'register',
      'login',
      'verifyEmail',
      'requestPasswordReset',
      'resetPassword',
      'logout',
      'revokeAll',
      'upgradeGuest',
      'addEmailToLegacyAccount',
      'resendVerification',
      'update',
      'exportAccount',
      'deleteAccount',
      'createGuest',
    ),
    access: fns(
      'requireOwner',
      'requirePlayerController',
      'requireReversalAuthority',
      'ownerJoinCode',
      'hasAccessPassword',
      'createInvitation',
      'revokeInvitations',
      'removeLobbyPlayer',
      'joinLobby',
      'requireLobbySeat',
      'linkedMembers',
      'invitation',
      'getJoinCredentials',
      'verifyGamePassword',
    ),
    statistics: fns('getFinalSnapshot', 'calculate', 'saveFinalSnapshot', 'pending', 'activity'),
    diceRolls: fns('list', 'record'),
    live: fns('mutate', 'connect', 'readAuction'),
    profileStatistics: fns('recordCompletedGame'),
    metrics: fns('record'),
  };
  const current = vi.fn(
    async (_request: Request, _id: string, _renewed?: (cookie: string) => void) => USER,
  );
  const requireMember = vi.fn(async () => 'PLAYER' as 'PLAYER' | 'OWNER');
  const controlledWallets = vi.fn(async () => [{ playerId: P1 }, { playerId: P2 }]);
  m.auth.current = current;
  m.access.requireMember = requireMember;
  m.access.controlledWallets = controlledWallets;
  m.games.getGame.mockResolvedValue(details());
  m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'LOBBY' });
  m.access.verifyGamePassword.mockResolvedValue(true);
  m.access.invitation.mockResolvedValue({ gameId: G, status: 'LOBBY' });
  m.auth.createGuest.mockResolvedValue({ profile: USER, cookie: 'guest=1' });
  m.auth.register.mockResolvedValue({ profile: USER, cookie: 'session=reg' });
  m.auth.login.mockResolvedValue({ profile: USER, cookie: 'session=login' });
  m.auth.upgradeGuest.mockResolvedValue({ profile: USER, cookie: 'session=up' });
  m.auth.logout.mockResolvedValue('session=; Max-Age=0');
  m.auth.revokeAll.mockResolvedValue('session=; Max-Age=0');
  m.auth.deleteAccount.mockResolvedValue('session=; Max-Age=0');
  m.live.mutate.mockImplementation(async () => Response.json({ data: { live: 'mutated' } }));
  m.live.connect.mockImplementation(async () => Response.json({ data: { live: 'connected' } }));
  m.live.readAuction.mockImplementation(async () => Response.json({ data: { live: 'auction' } }));
  const wiring = {
    games: m.games,
    banking: m.banking,
    auth: m.auth,
    access: m.access,
    profileStatistics: m.profileStatistics,
    metrics: m.metrics,
    ...(live ? { live: m.live } : {}),
    ...(options.statistics === false ? {} : { statistics: m.statistics }),
    ...(options.dice === false ? {} : { diceRolls: m.diceRolls }),
  };
  const router = createApiRouter(wiring as unknown as ApiRouterDependencies);
  return { router, m, requireMember };
}

const request = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request =>
  new Request(`https://bank.example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface Envelope {
  data?: unknown;
  error?: { code: string; message: string; requestId?: string };
}
const read = async (response: Response): Promise<Envelope> => (await response.json()) as Envelope;
const withCommand = { 'x-command-id': CMD };

describe('account routes', () => {
  it('registers with 201 and sets the session cookie', async () => {
    const { router, m } = harness();
    const response = await router(
      request('POST', '/api/auth/register', { nickname: 'Ann', avatar: '🙂', password: 'secret1' }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBe('session=reg');
    expect(await read(response)).toEqual({ data: USER });
    expect(m.auth.register).toHaveBeenCalledWith({
      nickname: 'Ann',
      avatar: '🙂',
      password: 'secret1',
    });
  });

  it('logs in with the request id and sets the cookie', async () => {
    const { router, m } = harness();
    const response = await router(
      request(
        'POST',
        '/api/auth/login',
        { nickname: 'Ann', password: 'secret1' },
        { 'x-request-id': 'request-id-1' },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBe('session=login');
    expect(response.headers.get('x-request-id')).toBe('request-id-1');
    expect(m.auth.login).toHaveBeenCalledWith(
      { nickname: 'Ann', password: 'secret1' },
      'request-id-1',
    );
  });

  it('generates a request id when the caller sends none or a malformed one', async () => {
    const { router } = harness();
    for (const headers of [
      {},
      { 'x-request-id': 'short' },
      { 'x-request-id': 'bad id with spaces!' },
    ]) {
      const response = await router(request('GET', '/api/profile', undefined, headers));
      const id = response.headers.get('x-request-id') ?? '';
      expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    }
  });

  it('verifies an email token and returns what the service returns', async () => {
    const { router, m } = harness();
    m.auth.verifyEmail.mockResolvedValue({ verified: true });
    const response = await router(
      request('POST', '/api/auth/verify-email', { token: 'a'.repeat(32) }),
    );
    expect(await read(response)).toEqual({ data: { verified: true } });
    expect(m.auth.verifyEmail).toHaveBeenCalledWith('a'.repeat(32));
  });

  it('accepts a password-reset request with 202 and confirms a reset with null data', async () => {
    const { router, m } = harness();
    const asked = await router(request('POST', '/api/auth/password-reset', { email: 'A@b.co' }));
    expect(asked.status).toBe(202);
    expect(await read(asked)).toEqual({ data: { accepted: true } });
    expect(m.auth.requestPasswordReset).toHaveBeenCalledWith('a@b.co');
    const done = await router(
      request('POST', '/api/auth/password-reset/confirm', {
        token: 'a'.repeat(32),
        password: 'secret1',
      }),
    );
    expect(done.status).toBe(200);
    expect(await read(done)).toEqual({ data: null });
    expect(m.auth.resetPassword).toHaveBeenCalledWith('a'.repeat(32), 'secret1');
  });

  it('logs out and sends the cookie the service returned', async () => {
    const { router } = harness();
    const response = await router(request('POST', '/api/auth/logout'));
    expect(response.headers.get('set-cookie')).toBe('session=; Max-Age=0');
    expect(await read(response)).toEqual({ data: null });
  });

  it('revokes every session of the signed-in account', async () => {
    const { router, m } = harness();
    const response = await router(request('POST', '/api/auth/sessions/revoke-all'));
    expect(m.auth.revokeAll).toHaveBeenCalledWith(USER.id);
    expect(response.headers.get('set-cookie')).toBe('session=; Max-Age=0');
  });

  it('upgrades a guest and adds an email to a legacy account', async () => {
    const { router, m } = harness();
    const upgraded = await router(
      request('POST', '/api/auth/upgrade', { email: 'A@b.co', password: 'secret1' }),
    );
    expect(m.auth.upgradeGuest).toHaveBeenCalledWith(USER.id, 'a@b.co', 'secret1');
    expect(upgraded.headers.get('set-cookie')).toBe('session=up');
    await router(request('POST', '/api/auth/email', { email: 'A@b.co' }));
    expect(m.auth.addEmailToLegacyAccount).toHaveBeenCalledWith(USER.id, 'a@b.co');
    const resent = await router(request('POST', '/api/auth/verification-email'));
    expect(resent.status).toBe(202);
    expect(m.auth.resendVerification).toHaveBeenCalledWith(USER.id);
  });

  it('reads and updates the profile, and refuses another method', async () => {
    const { router, m } = harness();
    expect(await read(await router(request('GET', '/api/profile')))).toEqual({ data: USER });
    m.auth.update.mockResolvedValue({ ...USER, nickname: 'New' });
    const patched = await router(
      request('PATCH', '/api/profile', { nickname: 'New', avatar: '🙂' }),
    );
    expect(m.auth.update).toHaveBeenCalledWith(USER.id, 'New', '🙂');
    expect(await read(patched)).toEqual({ data: { ...USER, nickname: 'New' } });
    const other = await router(request('DELETE', '/api/profile'));
    expect(other.status).toBe(404);
  });

  it('records a PWA telemetry event and refuses an unknown one', async () => {
    const { router, m } = harness();
    for (const event of ['UPDATE_AVAILABLE', 'UPDATE_APPLIED', 'OFFLINE_SHELL']) {
      const response = await router(request('POST', '/api/telemetry/pwa', { event }));
      expect(response.status).toBe(202);
      expect(m.metrics.record).toHaveBeenLastCalledWith(
        'pwa',
        event.toLowerCase(),
        'success',
        0,
        202,
      );
    }
    const refused = await router(request('POST', '/api/telemetry/pwa', { event: 'OTHER' }));
    expect(refused.status).toBe(400);
    expect((await read(refused)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('exports and deletes the account', async () => {
    const { router, m } = harness();
    m.auth.exportAccount.mockResolvedValue({ exported: true });
    expect(await read(await router(request('GET', '/api/account/export')))).toEqual({
      data: { exported: true },
    });
    const deleted = await router(request('DELETE', '/api/account'));
    expect(m.auth.deleteAccount).toHaveBeenCalledWith(USER.id);
    expect(deleted.headers.get('set-cookie')).toBe('session=; Max-Age=0');
    expect(await read(deleted)).toEqual({ data: null });
  });

  it('asks the session service for the actor and only renews the cookie for plain requests', async () => {
    const { router, m } = harness();
    await router(request('GET', '/api/profile'));
    expect(m.auth.current.mock.calls[0]?.[2]).toBeTypeOf('function');
    await router(request('GET', '/api/profile', undefined, { upgrade: 'WebSocket' }));
    expect(m.auth.current.mock.calls[1]?.[2]).toBeUndefined();
  });

  it('answers an unknown endpoint with 404', async () => {
    const { router } = harness();
    const response = await router(request('GET', '/api/unknown'));
    expect(response.status).toBe(404);
    expect(await read(response)).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    });
  });
});

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

  it('seats a player directly in the first free colour', async () => {
    const { router, m } = harness();
    const response = await router(join({ joinCode: 'ABCD' }));
    expect(response.status).toBe(200);
    expect(m.access.requireLobbySeat).toHaveBeenCalledWith(G, USER.id, 2);
    const joined = m.access.joinLobby.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(joined).toMatchObject({
      gameId: G,
      userId: USER.id,
      nickname: 'Test',
      color: '#27ae60',
      startingBalance: 1500,
    });
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

describe('live connection and summary routes', () => {
  const live = (headers: Record<string, string> = {}) =>
    request('GET', `/api/games/${G}/live`, undefined, {
      upgrade: 'websocket',
      origin: 'https://bank.example.test',
      ...headers,
    });

  it('forwards a member’s upgrade to the live game', async () => {
    const { router, m } = harness({ live: true });
    const response = await router(live());
    expect(await read(response)).toEqual({ data: { live: 'connected' } });
    expect(m.live.connect).toHaveBeenCalledWith(G, USER, expect.any(Request));
  });

  it('refuses a finished game with 409, a missing gateway with 503 and a foreign origin with 403', async () => {
    const finished = harness({ live: true });
    finished.m.games.getGame.mockResolvedValue(details({ status: 'FINISHED' }));
    const done = await finished.router(live());
    expect(done.status).toBe(409);
    expect((await read(done)).error).toMatchObject({
      code: 'GAME_FINISHED',
      message: 'This game is finished.',
    });
    const none = await harness().router(live());
    expect(none.status).toBe(503);
    expect((await read(none)).error).toMatchObject({
      code: 'LIVE_UNAVAILABLE',
      message: 'Live games are not configured.',
    });
    const foreign = await harness({ live: true }).router(live({ origin: 'https://attacker.test' }));
    expect(foreign.status).toBe(403);
  });

  it('refuses the summary when statistics are not configured', async () => {
    const { router } = harness({ statistics: false });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(response.status).toBe(409);
    expect((await read(response)).error).toMatchObject({
      code: 'STATISTICS_UNAVAILABLE',
      message: 'Statistics are not configured.',
    });
  });

  it('calculates the summary of a running game and names no winners', async () => {
    const { router, m } = harness();
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 5 });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(await read(response)).toEqual({
      data: { game: details().game, winners: [], totalMoneyTransferred: 5 },
    });
    expect(m.statistics.getFinalSnapshot).not.toHaveBeenCalled();
    expect(m.statistics.calculate).toHaveBeenCalledWith(details().game, details().players);
  });

  it('reads the stored snapshot of a finished game and names its winners', async () => {
    const { router, m } = harness();
    const finished = details({ status: 'FINISHED' });
    m.games.getGame.mockResolvedValue(finished);
    m.statistics.getFinalSnapshot.mockResolvedValue({
      summary: { totalMoneyTransferred: 9 },
      winnerPlayerIds: [P2, 'ghost'],
    });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(await read(response)).toEqual({
      data: { game: finished.game, winners: [finished.players[1]], totalMoneyTransferred: 9 },
    });
    expect(m.statistics.calculate).not.toHaveBeenCalled();
  });

  it('calculates the summary of a finished game that has no snapshot', async () => {
    const { router, m } = harness();
    m.games.getGame.mockResolvedValue(details({ status: 'FINISHED' }));
    m.statistics.getFinalSnapshot.mockResolvedValue(null);
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 1 });
    expect(await read(await router(request('GET', `/api/games/${G}/summary`)))).toMatchObject({
      data: { winners: [], totalMoneyTransferred: 1 },
    });
  });
});

describe('finishing a game', () => {
  const finish = (winnerPlayerIds: string[]) =>
    request('POST', `/api/games/${G}/finish`, { winnerPlayerIds }, withCommand);

  it('refuses winners who do not belong to the game', async () => {
    const { router, m } = harness();
    const response = await router(finish(['00000000-0000-4000-8000-0000000000ff']));
    expect(response.status).toBe(400);
    expect((await read(response)).error?.message).toBe('winnerPlayerIds must belong to this game.');
    expect(m.games.finishGame).not.toHaveBeenCalled();
  });

  it('finishes through the live game', async () => {
    const { router, m } = harness({ live: true });
    await router(finish([P1]));
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'FINISH_GAME',
      commandId: CMD,
      winnerPlayerIds: [P1],
    });
  });

  it('refuses to finish without statistics', async () => {
    const { router } = harness({ statistics: false });
    const response = await router(finish([P1]));
    expect(response.status).toBe(409);
    expect((await read(response)).error?.code).toBe('STATISTICS_UNAVAILABLE');
  });

  it('saves the snapshot, finishes the game and records who won for each linked account', async () => {
    const { router, m } = harness();
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 3 });
    m.games.finishGame.mockResolvedValue(details({ status: 'FINISHED' }));
    m.access.linkedMembers.mockResolvedValue([
      { userId: 'u1', playerId: P1 },
      { userId: 'u2', playerId: P2 },
      { userId: 'u3', playerId: null },
    ]);
    const response = await router(finish([P1]));
    expect(await read(response)).toEqual({ data: details({ status: 'FINISHED' }) });
    expect(m.statistics.saveFinalSnapshot).toHaveBeenCalledWith(G, [P1], {
      totalMoneyTransferred: 3,
    });
    expect(m.profileStatistics.recordCompletedGame).toHaveBeenCalledWith(G, [
      { userId: 'u1', won: true },
      { userId: 'u2', won: false },
    ]);
  });
});

describe('activity feed', () => {
  const feed = (query: string) => request('GET', `/api/games/${G}/activity${query}`);
  const cursor = btoa(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: R }));

  it('lists the whole game by default with the maximum page size', async () => {
    const { router, m } = harness();
    m.statistics.activity.mockResolvedValue({ items: [] });
    const response = await router(feed(''));
    expect(await read(response)).toEqual({ data: { items: [] } });
    expect(m.statistics.activity).toHaveBeenCalledWith(G, 'ALL', [P1, P2], null, 100);
  });

  it('lists the viewer’s own wallets, a cursor and a smaller page', async () => {
    const { router, m } = harness();
    await router(feed(`?scope=MINE&limit=5&cursor=${encodeURIComponent(cursor)}`));
    expect(m.statistics.activity).toHaveBeenCalledWith(
      G,
      'MINE',
      [P1, P2],
      { createdAt: '2026-01-01T00:00:00.000Z', id: R },
      5,
    );
  });

  it('lists what is pending for the viewer through its own query', async () => {
    const { router, m } = harness();
    await router(feed('?scope=PENDING&limit=1'));
    expect(m.statistics.pending).toHaveBeenCalledWith(G, [P1, P2], null, 1);
    expect(m.statistics.activity).not.toHaveBeenCalled();
  });

  it.each([
    ['?scope=OTHER', 'scope must be ALL, MINE, or PENDING.'],
    ['?limit=0', 'limit must be an integer between 1 and 100.'],
    ['?limit=101', 'limit must be an integer between 1 and 100.'],
    ['?limit=1.5', 'limit must be an integer between 1 and 100.'],
    ['?limit=abc', 'limit must be an integer between 1 and 100.'],
    ['?cursor=%%%', 'cursor is invalid.'],
    [`?cursor=${btoa('not json')}`, 'cursor is invalid.'],
    [`?cursor=${btoa(JSON.stringify({ createdAt: 5, id: R }))}`, 'cursor is invalid.'],
    [`?cursor=${btoa(JSON.stringify({ createdAt: 'x', id: 'short' }))}`, 'cursor is invalid.'],
    [`?cursor=${btoa('null')}`, 'cursor is invalid.'],
  ])('refuses %s', async (query, message) => {
    const { router } = harness();
    const response = await router(feed(query));
    expect(response.status).toBe(400);
    expect((await read(response)).error?.message).toBe(message);
  });

  it('accepts the limits 1 and 100', async () => {
    const { router, m } = harness();
    await router(feed('?limit=1'));
    await router(feed('?limit=100'));
    expect(m.statistics.activity.mock.calls.map((call) => call[4])).toEqual([1, 100]);
  });

  it('refuses without statistics', async () => {
    const { router } = harness({ statistics: false });
    expect((await router(feed(''))).status).toBe(409);
  });
});

describe('auction routes', () => {
  const lot = { initiatorPlayerId: P1, lotName: 'Lot' };

  it('reads the auction through the live game and says so when there is none', async () => {
    const { router, m } = harness({ live: true });
    const response = await router(request('GET', `/api/games/${G}/auction`));
    expect(await read(response)).toEqual({ data: { live: 'auction' } });
    expect(m.live.readAuction).toHaveBeenCalledWith(G, USER);
    const none = await harness().router(request('GET', `/api/games/${G}/auction`));
    expect(none.status).toBe(503);
    expect((await read(none)).error?.code).toBe('LIVE_UNAVAILABLE');
  });

  it('starts an auction for a wallet the caller controls', async () => {
    const { router, m } = harness({ live: true });
    await router(request('POST', `/api/games/${G}/auctions`, lot, withCommand));
    expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'START_AUCTION',
      commandId: CMD,
      request: lot,
    });
    const none = await harness().router(
      request('POST', `/api/games/${G}/auctions`, lot, withCommand),
    );
    expect(none.status).toBe(503);
  });

  it('places a bid for a wallet the caller controls', async () => {
    const { router, m } = harness({ live: true });
    const bid = { bidderPlayerId: P2, expectedVersion: 1, step: 25 };
    await router(request('POST', `/api/games/${G}/auctions/${R}/bids`, bid, withCommand));
    expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P2);
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'PLACE_BID',
      commandId: CMD,
      request: { ...bid, auctionId: R },
    });
    const none = await harness().router(
      request('POST', `/api/games/${G}/auctions/${R}/bids`, bid, withCommand),
    );
    expect(none.status).toBe(503);
  });

  it('does not forward an auction command for a wallet the caller does not control', async () => {
    const { router, m } = harness({ live: true });
    m.access.requirePlayerController.mockRejectedValue(new ForbiddenError());
    const response = await router(request('POST', `/api/games/${G}/auctions`, lot, withCommand));
    expect(response.status).toBe(403);
    expect(m.live.mutate).not.toHaveBeenCalled();
  });

  it('refuses a live command without a valid command id', async () => {
    const { router, m } = harness({ live: true });
    for (const headers of [
      {},
      { 'x-command-id': 'nope' },
      { 'x-command-id': CMD.replace('-4000-', '-1000-') },
    ]) {
      const response = await router(request('POST', `/api/games/${G}/auctions`, lot, headers));
      expect(response.status).toBe(400);
      expect((await read(response)).error?.message).toBe('x-command-id must be a UUID v4.');
    }
    expect(m.live.mutate).not.toHaveBeenCalled();
  });
});

describe('bankruptcy and transaction routes', () => {
  it('declares bankruptcy directly with 201 or through the live game', async () => {
    const direct = harness();
    direct.m.banking.declareBankruptcy.mockResolvedValue({ transaction: { id: 't' } });
    const response = await direct.router(
      request('POST', `/api/games/${G}/bankruptcy`, { playerId: P1 }),
    );
    expect(response.status).toBe(201);
    expect(direct.m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(direct.m.banking.declareBankruptcy).toHaveBeenCalledWith(G, { playerId: P1 });
    const live = harness({ live: true });
    await live.router(
      request(
        'POST',
        `/api/games/${G}/bankruptcy`,
        { playerId: P1, creditorPlayerId: P2 },
        withCommand,
      ),
    );
    expect(live.m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'DECLARE_BANKRUPTCY',
      commandId: CMD,
      request: { playerId: P1, creditorPlayerId: P2 },
    });
  });

  it('creates a transaction for the wallet that pays, directly or live', async () => {
    const body = {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: P1,
      destinationPlayerId: P2,
      amount: 5,
    };
    const direct = harness();
    const response = await direct.router(request('POST', `/api/games/${G}/transactions`, body));
    expect(response.status).toBe(201);
    expect(direct.m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(direct.m.banking.createTransaction).toHaveBeenCalledWith(G, body);
    const live = harness({ live: true });
    await live.router(request('POST', `/api/games/${G}/transactions`, body, withCommand));
    expect(live.m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'CREATE_TRANSACTION',
      commandId: CMD,
      request: body,
    });
  });

  it('asks the access service about reversal authority instead of wallet control for a reversal', async () => {
    const { router, m } = harness();
    m.banking.getTransaction.mockResolvedValue({ id: T });
    await router(
      request('POST', `/api/games/${G}/transactions`, { type: 'REVERSAL', transactionId: T }),
    );
    expect(m.access.requireReversalAuthority).toHaveBeenCalledWith(G, USER.id, { id: T });
    expect(m.access.requirePlayerController).not.toHaveBeenCalled();
    expect(m.banking.createTransaction).toHaveBeenCalled();
  });

  it('refuses to reverse a transaction that does not exist', async () => {
    const { router, m } = harness();
    m.banking.getTransaction.mockResolvedValue(null);
    const response = await router(
      request('POST', `/api/games/${G}/transactions`, { type: 'REVERSAL', transactionId: T }),
    );
    expect(response.status).toBe(404);
    expect((await read(response)).error?.code).toBe('TRANSACTION_NOT_FOUND');
    expect(m.banking.createTransaction).not.toHaveBeenCalled();
  });

  it('lists transactions with the default and an explicit page size', async () => {
    const { router, m } = harness();
    m.banking.listTransactions.mockResolvedValue([{ id: T }]);
    expect(await read(await router(request('GET', `/api/games/${G}/transactions`)))).toEqual({
      data: [{ id: T }],
    });
    await router(request('GET', `/api/games/${G}/transactions?limit=7`));
    expect(m.banking.listTransactions.mock.calls.map((call) => call[1])).toEqual([100, 7]);
    expect((await router(request('GET', `/api/games/${G}/transactions?limit=0`))).status).toBe(400);
    expect((await router(request('PUT', `/api/games/${G}/transactions`, {}))).status).toBe(404);
  });

  it('lists a player’s transactions only for a wallet the caller controls', async () => {
    const { router, m } = harness();
    m.banking.listPlayerTransactions.mockResolvedValue([{ id: T }]);
    const response = await router(
      request('GET', `/api/games/${G}/players/${P1}/transactions?limit=3`),
    );
    expect(await read(response)).toEqual({ data: [{ id: T }] });
    expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(m.banking.listPlayerTransactions).toHaveBeenCalledWith(G, P1, 3);
    m.access.requirePlayerController.mockRejectedValue(new ForbiddenError());
    expect(
      (await router(request('GET', `/api/games/${G}/players/${P1}/transactions`))).status,
    ).toBe(403);
  });
});

describe('payment request routes', () => {
  const paymentRequest = { id: R, creatorPlayerId: P1, approverPlayerId: P2 };
  const act = (action: string) =>
    request('POST', `/api/games/${G}/payment-requests/${R}/${action}`, undefined, withCommand);

  it('lists the requests of the caller’s wallets', async () => {
    const { router, m } = harness();
    m.banking.listPaymentRequests.mockResolvedValue([paymentRequest]);
    expect(await read(await router(request('GET', `/api/games/${G}/payment-requests`)))).toEqual({
      data: [paymentRequest],
    });
    expect(m.banking.listPaymentRequests).toHaveBeenCalledWith(G, [P1, P2]);
  });

  it('refuses an unknown request with its own code', async () => {
    const { router, m } = harness();
    m.banking.getPaymentRequest.mockResolvedValue(null);
    const response = await router(act('accept'));
    expect(response.status).toBe(404);
    expect((await read(response)).error).toMatchObject({
      code: 'PAYMENT_REQUEST_NOT_FOUND',
      message: 'Payment request not found.',
    });
  });

  it.each([
    ['accept', 'acceptPaymentRequest', P2],
    ['decline', 'declinePaymentRequest', P2],
    ['cancel', 'cancelPaymentRequest', P1],
  ] as const)(
    '%s needs the wallet that may %s it and runs %s',
    async (action, method, controlled) => {
      const { router, m } = harness();
      m.banking.getPaymentRequest.mockResolvedValue(paymentRequest);
      m.banking[method].mockResolvedValue({ paymentRequest });
      const response = await router(act(action));
      expect(await read(response)).toEqual({ data: { paymentRequest } });
      expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, controlled);
      expect(m.banking[method]).toHaveBeenCalledWith(G, R);
    },
  );

  it.each([
    ['accept', 'ACCEPT_PAYMENT_REQUEST'],
    ['decline', 'DECLINE_PAYMENT_REQUEST'],
    ['cancel', 'CANCEL_PAYMENT_REQUEST'],
  ] as const)('%s goes through the live game as %s', async (action, type) => {
    const { router, m } = harness({ live: true });
    m.banking.getPaymentRequest.mockResolvedValue(paymentRequest);
    await router(act(action));
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type,
      commandId: CMD,
      paymentRequestId: R,
    });
  });

  it('refuses a malformed request id', async () => {
    const { router } = harness();
    const response = await router(
      request('POST', `/api/games/${G}/payment-requests/nope/accept`, undefined, withCommand),
    );
    expect((await read(response)).error?.message).toBe('paymentRequestId must be a UUID.');
  });
});

describe('trade request routes', () => {
  const trade = { id: T, proposerPlayerId: P1, counterpartyPlayerId: P2 };
  const act = (action: string) =>
    request('POST', `/api/games/${G}/trade-requests/${T}/${action}`, undefined, withCommand);
  const proposal = {
    id: T,
    playerId: P1,
    counterpartyPlayerId: P2,
    giveTileIds: ['zhitna'],
    takeTileIds: [],
  };

  it('lists the trades of the caller’s wallets', async () => {
    const { router, m } = harness();
    m.banking.listTradeRequests.mockResolvedValue([trade]);
    expect(await read(await router(request('GET', `/api/games/${G}/trade-requests`)))).toEqual({
      data: [trade],
    });
    expect(m.banking.listTradeRequests).toHaveBeenCalledWith(G, [P1, P2]);
  });

  it('proposes a trade from a wallet the caller controls, directly with 201 or live', async () => {
    const direct = harness();
    const response = await direct.router(
      request('POST', `/api/games/${G}/trade-requests`, proposal),
    );
    expect(response.status).toBe(201);
    expect(direct.m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(direct.m.banking.createTradeRequest).toHaveBeenCalledWith(G, proposal);
    const live = harness({ live: true });
    await live.router(request('POST', `/api/games/${G}/trade-requests`, proposal, withCommand));
    expect(live.m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'CREATE_TRADE_REQUEST',
      commandId: CMD,
      request: proposal,
    });
  });

  it('refuses an unknown trade with its own code', async () => {
    const { router, m } = harness();
    m.banking.getTradeRequest.mockResolvedValue(null);
    const response = await router(act('accept'));
    expect(response.status).toBe(404);
    expect((await read(response)).error).toMatchObject({
      code: 'TRADE_REQUEST_NOT_FOUND',
      message: 'Trade request not found.',
    });
  });

  it.each([
    ['accept', 'acceptTradeRequest', P2],
    ['decline', 'declineTradeRequest', P2],
    ['cancel', 'cancelTradeRequest', P1],
  ] as const)(
    '%s needs the wallet that may %s it and runs %s',
    async (action, method, controlled) => {
      const { router, m } = harness();
      m.banking.getTradeRequest.mockResolvedValue(trade);
      m.banking[method].mockResolvedValue({ tradeRequest: trade });
      const response = await router(act(action));
      expect(await read(response)).toEqual({ data: { tradeRequest: trade } });
      expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, controlled);
      expect(m.banking[method]).toHaveBeenCalledWith(G, T);
    },
  );

  it.each([
    ['accept', 'ACCEPT_TRADE_REQUEST'],
    ['decline', 'DECLINE_TRADE_REQUEST'],
    ['cancel', 'CANCEL_TRADE_REQUEST'],
  ] as const)('%s goes through the live game as %s', async (action, type) => {
    const { router, m } = harness({ live: true });
    m.banking.getTradeRequest.mockResolvedValue(trade);
    await router(act(action));
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type,
      commandId: CMD,
      tradeRequestId: T,
    });
  });
});

describe('dice roll routes', () => {
  const url = `/api/games/${G}/players/${P1}/dice-rolls`;

  it('lists with the default and an explicit limit, for any member', async () => {
    const { router, m } = harness();
    m.diceRolls.list.mockResolvedValue([{ id: R }]);
    expect(await read(await router(request('GET', url)))).toEqual({ data: [{ id: R }] });
    await router(request('GET', `${url}?limit=5`));
    expect(m.diceRolls.list.mock.calls.map((call) => call[2])).toEqual([20, 5]);
    expect(m.access.requirePlayerController).not.toHaveBeenCalled();
    expect((await router(request('GET', `${url}?limit=101`))).status).toBe(400);
  });

  it('records a roll for a controlled wallet with 201', async () => {
    const { router, m } = harness();
    m.diceRolls.record.mockResolvedValue({ id: R });
    const response = await router(request('POST', url, { id: R, dieOne: 3, dieTwo: 4 }));
    expect(response.status).toBe(201);
    expect(m.access.requirePlayerController).toHaveBeenCalledWith(G, USER.id, P1);
    expect(m.diceRolls.record).toHaveBeenCalledWith(G, P1, { id: R, dieOne: 3, dieTwo: 4 });
  });

  it('says dice are unavailable when the service is not configured, and refuses other methods', async () => {
    const { router } = harness({ dice: false });
    const response = await router(request('GET', url));
    expect(response.status).toBe(409);
    expect((await read(response)).error).toMatchObject({
      code: 'DICE_UNAVAILABLE',
      message: 'Dice history is not configured.',
    });
    expect((await harness().router(request('DELETE', url))).status).toBe(404);
  });
});
