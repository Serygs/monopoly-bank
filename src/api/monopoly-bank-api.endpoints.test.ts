import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MonopolyBankApiError,
  monopolyBankApi,
  type MonopolyBankApi,
} from './monopoly-bank-api.js';

const G = '00000000-0000-4000-8000-000000000001';
const P = '00000000-0000-4000-8000-000000000002';
const X = 'a/b c';
const CMD = '00000000-0000-4000-8000-0000000000c1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface Recorded {
  url: string;
  method: string | undefined;
  body: unknown;
  headers: Headers;
}

function stubFetch(respond: () => Response | Promise<Response> = () => ok('payload')): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
      headers: new Headers(init?.headers),
    });
    return respond();
  });
  return calls;
}
const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
const caught = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

afterEach(() => vi.unstubAllGlobals());

type Endpoint = [
  name: string,
  call: (api: MonopolyBankApi) => Promise<unknown>,
  method: string | undefined,
  url: string,
  body: unknown,
  command: boolean,
];

const endpoints: Endpoint[] = [
  ['currentProfile', (api) => api.currentProfile(), undefined, '/api/profile', undefined, false],
  [
    'register',
    (api) => api.register({ nickname: 'A', avatar: 'x', password: 'secret1' }),
    'POST',
    '/api/auth/register',
    { nickname: 'A', avatar: 'x', password: 'secret1' },
    false,
  ],
  [
    'login',
    (api) => api.login({ nickname: 'A', password: 'secret1' }),
    'POST',
    '/api/auth/login',
    { nickname: 'A', password: 'secret1' },
    false,
  ],
  [
    'verifyEmail',
    (api) => api.verifyEmail('tok'),
    'POST',
    '/api/auth/verify-email',
    { token: 'tok' },
    false,
  ],
  [
    'requestPasswordReset',
    (api) => api.requestPasswordReset('a@b.co'),
    'POST',
    '/api/auth/password-reset',
    { email: 'a@b.co' },
    false,
  ],
  [
    'confirmPasswordReset',
    (api) => api.confirmPasswordReset('tok', 'secret1'),
    'POST',
    '/api/auth/password-reset/confirm',
    { token: 'tok', password: 'secret1' },
    false,
  ],
  [
    'resendVerification',
    (api) => api.resendVerification(),
    'POST',
    '/api/auth/verification-email',
    undefined,
    false,
  ],
  ['logout', (api) => api.logout(), 'POST', '/api/auth/logout', undefined, false],
  [
    'updateProfile',
    (api) => api.updateProfile({ nickname: 'A', avatar: 'x' }),
    'PATCH',
    '/api/profile',
    { nickname: 'A', avatar: 'x' },
    false,
  ],
  ['listGames', (api) => api.listGames(), undefined, '/api/games', undefined, false],
  [
    'createGame',
    (api) =>
      api.createGame({
        name: 'T',
        startingBalance: 1,
        passGoReward: 1,
        currency: 'USD',
        players: [],
      }),
    'POST',
    '/api/games',
    { name: 'T', startingBalance: 1, passGoReward: 1, currency: 'USD', players: [] },
    false,
  ],
  [
    'joinGame',
    (api) => api.joinGame({ joinCode: 'ABCD' }),
    'POST',
    '/api/games/join',
    { joinCode: 'ABCD' },
    true,
  ],
  [
    'joinGameAsGuest',
    (api) => api.joinGameAsGuest({ nickname: 'A', avatar: 'x', joinCode: 'ABCD' }),
    'POST',
    '/api/games/join/guest',
    { nickname: 'A', avatar: 'x', joinCode: 'ABCD' },
    true,
  ],
  [
    'upgradeGuest',
    (api) => api.upgradeGuest({ email: 'a@b.co', password: 'secret1' }),
    'POST',
    '/api/auth/upgrade',
    { email: 'a@b.co', password: 'secret1' },
    false,
  ],
  [
    'addEmailToLegacyAccount',
    (api) => api.addEmailToLegacyAccount({ email: 'a@b.co' }),
    'POST',
    '/api/auth/email',
    { email: 'a@b.co' },
    false,
  ],
  [
    'removeLobbyPlayer',
    (api) => api.removeLobbyPlayer(X, P),
    'DELETE',
    `/api/games/${encodeURIComponent(X)}/players/${P}`,
    undefined,
    true,
  ],
  [
    'createInvitation',
    (api) => api.createInvitation(G),
    'POST',
    `/api/games/${G}/invitations`,
    undefined,
    true,
  ],
  [
    'revokeInvitations',
    (api) => api.revokeInvitations(G),
    'DELETE',
    `/api/games/${G}/invitations`,
    undefined,
    true,
  ],
  [
    'getGame',
    (api) => api.getGame(X),
    undefined,
    `/api/games/${encodeURIComponent(X)}`,
    undefined,
    false,
  ],
  ['deleteGame', (api) => api.deleteGame(G), 'DELETE', `/api/games/${G}`, undefined, false],
  [
    'listDeletedGames',
    (api) => api.listDeletedGames(),
    undefined,
    '/api/games/deleted',
    undefined,
    false,
  ],
  ['restoreGame', (api) => api.restoreGame(G), 'POST', `/api/games/${G}/restore`, undefined, false],
  [
    'duplicateGame',
    (api) => api.duplicateGame(G, 'abcd'),
    'POST',
    `/api/games/${G}/duplicate`,
    { gameAccessPassword: 'abcd' },
    false,
  ],
  ['startGame', (api) => api.startGame(G), 'POST', `/api/games/${G}/start`, undefined, true],
  [
    'finishGame',
    (api) => api.finishGame(G, { winnerPlayerIds: [P] }),
    'POST',
    `/api/games/${G}/finish`,
    { winnerPlayerIds: [P] },
    true,
  ],
  [
    'toggleFavoriteAmount',
    (api) => api.toggleFavoriteAmount(G, 50),
    'POST',
    `/api/games/${G}/favorite-amounts`,
    { amount: 50 },
    false,
  ],
  [
    'listDiceRolls',
    (api) => api.listDiceRolls(G, P),
    undefined,
    `/api/games/${G}/players/${P}/dice-rolls?limit=20`,
    undefined,
    false,
  ],
  [
    'listDiceRolls with a limit',
    (api) => api.listDiceRolls(G, P, 5),
    undefined,
    `/api/games/${G}/players/${P}/dice-rolls?limit=5`,
    undefined,
    false,
  ],
  [
    'recordDiceRoll',
    (api) => api.recordDiceRoll(G, P, { id: CMD, dieOne: 1, dieTwo: 2 }),
    'POST',
    `/api/games/${G}/players/${P}/dice-rolls`,
    { id: CMD, dieOne: 1, dieTwo: 2 },
    false,
  ],
  [
    'createTransaction',
    (api) => api.createTransaction(G, { type: 'PASS_GO', playerId: P }),
    'POST',
    `/api/games/${G}/transactions`,
    { type: 'PASS_GO', playerId: P },
    true,
  ],
  [
    'listPaymentRequests',
    (api) => api.listPaymentRequests(G),
    undefined,
    `/api/games/${G}/payment-requests`,
    undefined,
    false,
  ],
  [
    'acceptPaymentRequest',
    (api) => api.acceptPaymentRequest(G, X),
    'POST',
    `/api/games/${G}/payment-requests/${encodeURIComponent(X)}/accept`,
    undefined,
    true,
  ],
  [
    'declinePaymentRequest',
    (api) => api.declinePaymentRequest(G, P),
    'POST',
    `/api/games/${G}/payment-requests/${P}/decline`,
    undefined,
    true,
  ],
  [
    'cancelPaymentRequest',
    (api) => api.cancelPaymentRequest(G, P),
    'POST',
    `/api/games/${G}/payment-requests/${P}/cancel`,
    undefined,
    true,
  ],
  [
    'createTradeRequest',
    (api) =>
      api.createTradeRequest(G, {
        id: CMD,
        playerId: P,
        counterpartyPlayerId: G,
        giveTileIds: ['a'],
        takeTileIds: [],
      }),
    'POST',
    `/api/games/${G}/trade-requests`,
    { id: CMD, playerId: P, counterpartyPlayerId: G, giveTileIds: ['a'], takeTileIds: [] },
    true,
  ],
  [
    'acceptTradeRequest',
    (api) => api.acceptTradeRequest(G, P),
    'POST',
    `/api/games/${G}/trade-requests/${P}/accept`,
    undefined,
    true,
  ],
  [
    'declineTradeRequest',
    (api) => api.declineTradeRequest(G, P),
    'POST',
    `/api/games/${G}/trade-requests/${P}/decline`,
    undefined,
    true,
  ],
  [
    'cancelTradeRequest',
    (api) => api.cancelTradeRequest(G, P),
    'POST',
    `/api/games/${G}/trade-requests/${P}/cancel`,
    undefined,
    true,
  ],
  [
    'regenerateJoinCode',
    (api) => api.regenerateJoinCode(G),
    'POST',
    `/api/games/${G}/join-code/regenerate`,
    undefined,
    false,
  ],
  [
    'declareBankruptcy',
    (api) => api.declareBankruptcy(G, { playerId: P }),
    'POST',
    `/api/games/${G}/bankruptcy`,
    { playerId: P },
    true,
  ],
  [
    'getAuction',
    (api) => api.getAuction(G),
    undefined,
    `/api/games/${G}/auction`,
    undefined,
    false,
  ],
  [
    'startAuction',
    (api) => api.startAuction(G, { initiatorPlayerId: P, lotName: 'Lot' }),
    'POST',
    `/api/games/${G}/auctions`,
    { initiatorPlayerId: P, lotName: 'Lot' },
    true,
  ],
  [
    'placeBid',
    (api) => api.placeBid(G, { bidderPlayerId: P, auctionId: X, expectedVersion: 2, step: 25 }),
    'POST',
    `/api/games/${G}/auctions/${encodeURIComponent(X)}/bids`,
    { bidderPlayerId: P, expectedVersion: 2, step: 25 },
    true,
  ],
  [
    'getGameSummary',
    (api) => api.getGameSummary(G),
    undefined,
    `/api/games/${G}/summary`,
    undefined,
    false,
  ],
  [
    'getActivity',
    (api) => api.getActivity(G, 'ALL'),
    undefined,
    `/api/games/${G}/activity?scope=ALL`,
    undefined,
    false,
  ],
  [
    'getActivity with a cursor',
    (api) => api.getActivity(G, 'MINE', 'c+/='),
    undefined,
    `/api/games/${G}/activity?scope=MINE&cursor=c%2B%2F%3D`,
    undefined,
    false,
  ],
  [
    'listTransactions',
    (api) => api.listTransactions(G),
    undefined,
    `/api/games/${G}/transactions?limit=50`,
    undefined,
    false,
  ],
  [
    'listTransactions with a limit',
    (api) => api.listTransactions(G, 7),
    undefined,
    `/api/games/${G}/transactions?limit=7`,
    undefined,
    false,
  ],
  [
    'listPlayerTransactions',
    (api) => api.listPlayerTransactions(G, P),
    undefined,
    `/api/games/${G}/players/${P}/transactions?limit=50`,
    undefined,
    false,
  ],
  [
    'listPlayerTransactions with a limit',
    (api) => api.listPlayerTransactions(G, P, 3),
    undefined,
    `/api/games/${G}/players/${P}/transactions?limit=3`,
    undefined,
    false,
  ],
];

describe('every endpoint of the API client', () => {
  it.each(endpoints)(
    '%s sends the right method, address and body',
    async (_name, call, method, url, body, command) => {
      const calls = stubFetch(() => ok('payload'));
      await call(monopolyBankApi);
      expect(calls).toHaveLength(1);
      const sent = calls[0] as Recorded;
      expect(sent.url).toBe(url);
      expect(sent.method).toBe(method);
      expect(sent.body).toEqual(body);
      expect(sent.headers.get('accept')).toBe('application/json');
      expect(sent.headers.get('content-type')).toBe(body === undefined ? null : 'application/json');
      expect(sent.headers.get('x-command-id') === null).toBe(!command);
      if (command) expect(sent.headers.get('x-command-id')).toMatch(UUID);
    },
  );

  it('returns the data the server wrapped, for the methods that return it', async () => {
    stubFetch(() => ok({ answer: 42 }));
    await expect(monopolyBankApi.getGame(G)).resolves.toEqual({ answer: 42 });
    await expect(monopolyBankApi.listGames()).resolves.toEqual({ answer: 42 });
  });

  it('returns nothing for the methods that only confirm', async () => {
    stubFetch(() => ok(null));
    await expect(monopolyBankApi.logout()).resolves.toBeUndefined();
    await expect(monopolyBankApi.resendVerification()).resolves.toBeUndefined();
    await expect(monopolyBankApi.requestPasswordReset('a@b.co')).resolves.toBeUndefined();
    await expect(monopolyBankApi.confirmPasswordReset('t', 'secret1')).resolves.toBeUndefined();
  });

  it('uses the command id it is given and makes a fresh one each time otherwise', async () => {
    const calls = stubFetch();
    await monopolyBankApi.startAuction(G, { initiatorPlayerId: P, lotName: 'L' }, CMD);
    await monopolyBankApi.acceptTradeRequest(G, P, CMD);
    await monopolyBankApi.cancelPaymentRequest(G, P, CMD);
    await monopolyBankApi.startGame(G);
    await monopolyBankApi.startGame(G);
    const ids = calls.map((call) => call.headers.get('x-command-id'));
    expect(ids.slice(0, 3)).toEqual([CMD, CMD, CMD]);
    expect(ids[3]).not.toBe(ids[4]);
  });

  it('keeps the auction id out of the body of a bid', async () => {
    const calls = stubFetch();
    await monopolyBankApi.placeBid(G, {
      bidderPlayerId: P,
      auctionId: CMD,
      expectedVersion: 1,
      step: 10,
    });
    expect(calls[0]?.body).not.toHaveProperty('auctionId');
  });
});

describe('reading a response', () => {
  it('turns a network failure into NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const error = await caught(() => monopolyBankApi.getGame(G));
    expect(error).toBeInstanceOf(MonopolyBankApiError);
    expect(error).toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Unable to reach Monopoly Bank. Please try again.',
    });
  });

  it('turns an error payload into an error with its code, message, details and request id', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'INSUFFICIENT_FUNDS',
              message: 'No',
              details: { shortfall: 5 },
              requestId: 'req-1',
            },
          }),
          { status: 409 },
        ),
    );
    const error = await caught(() => monopolyBankApi.getGame(G));
    expect(error).toBeInstanceOf(MonopolyBankApiError);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'No',
      details: { shortfall: 5 },
      requestId: 'req-1',
    });
  });

  it('prefers the error payload even on a response marked successful', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'X', message: 'm' }, data: 1 })));
    expect(await caught(() => monopolyBankApi.getGame(G))).toMatchObject({ code: 'X' });
  });

  it.each([
    ['a body that is not JSON', () => new Response('<html>', { status: 502 })],
    ['an empty body', () => new Response('', { status: 200 })],
    ['a JSON null', () => new Response('null', { status: 200 })],
    ['an object with no data', () => new Response('{}', { status: 200 })],
    [
      'a failure status with data',
      () => new Response(JSON.stringify({ data: 1 }), { status: 500 }),
    ],
    ['a JSON string', () => new Response('"text"', { status: 200 })],
  ])('reports %s as an unexpected response', async (_label, respond) => {
    stubFetch(respond);
    const error = await caught(() => monopolyBankApi.getGame(G));
    expect(error).toBeInstanceOf(MonopolyBankApiError);
    expect(error).toMatchObject({
      code: 'API_ERROR',
      message: 'The server returned an unexpected response.',
    });
  });

  it('accepts a successful response whose data is falsy', async () => {
    stubFetch(() => ok(0));
    await expect(monopolyBankApi.getGame(G)).resolves.toBe(0);
    stubFetch(() => ok(null));
    await expect(monopolyBankApi.getGame(G)).resolves.toBeNull();
  });
});
