import { afterEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from './monopoly-bank-api.js';

const gameId = '00000000-0000-4000-8000-000000000002';
const playerId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000003';
const commandIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function captureFetch(payload: unknown = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ data: payload }), { headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

describe('MonopolyBankApi transaction commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a caller-provided command ID so a retry stays idempotent', async () => {
    const calls = captureFetch({ transaction: {}, players: [] });
    const request = { type: 'PLAYER_TO_BANK' as const, playerId, amount: 100 };

    await monopolyBankApi.createTransaction(gameId, request, commandId);
    await monopolyBankApi.createTransaction(gameId, request, commandId);

    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0]?.init.headers).get('x-command-id')).toBe(commandId);
    expect(new Headers(calls[1]?.init.headers).get('x-command-id')).toBe(commandId);
  });

  it.each([
    ['registered', () => monopolyBankApi.joinGame({ joinCode: 'TABLE42' })],
    ['guest', () => monopolyBankApi.joinGameAsGuest({ joinCode: 'TABLE42', nickname: 'Guest', avatar: '🎩' })],
  ])('adds a command ID when a %s player joins through the realtime mutation path', async (_actor, join) => {
    const calls = captureFetch();

    await join();

    expect(new Headers(calls[0]?.init.headers).get('x-command-id')).toMatch(commandIdPattern);
  });
});

describe('MonopolyBankApi board routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['listBoards', () => monopolyBankApi.listBoards(), 'GET', '/api/boards'],
    ['getBoard', () => monopolyBankApi.getBoard('board-classic'), 'GET', '/api/boards/board-classic'],
    ['createBoard', () => monopolyBankApi.createBoard({ name: 'Ours', sourceBoardId: 'board-classic', spaceNames: {} }), 'POST', '/api/boards'],
    ['deleteBoard', () => monopolyBankApi.deleteBoard('board/x'), 'DELETE', '/api/boards/board%2Fx'],
    ['getPropertyState', () => monopolyBankApi.getPropertyState(gameId), 'GET', `/api/games/${gameId}/properties`],
    ['listTrades', () => monopolyBankApi.listTrades(gameId), 'GET', `/api/games/${gameId}/trades`],
  ])('%s reads or writes without a command id', async (_name, call, method, path) => {
    const calls = captureFetch([]);

    await call();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(path);
    expect(calls[0].init.method ?? 'GET').toBe(method);
    expect(new Headers(calls[0].init.headers).get('x-command-id')).toBeNull();
  });

  const space = { boardSpaceId: 'board-classic-space-01', playerId };
  it.each([
    ['purchaseProperty', (id?: string) => monopolyBankApi.purchaseProperty(gameId, space, id), `/api/games/${gameId}/properties/purchase`],
    ['chargeRent', (id?: string) => monopolyBankApi.chargeRent(gameId, { boardSpaceId: space.boardSpaceId, payerPlayerId: playerId, diceTotal: 7 }, id), `/api/games/${gameId}/properties/rent`],
    ['buildHouses', (id?: string) => monopolyBankApi.buildHouses(gameId, { ...space, count: 1 }, id), `/api/games/${gameId}/properties/build`],
    ['sellBuildings', (id?: string) => monopolyBankApi.sellBuildings(gameId, { ...space, count: 1 }, id), `/api/games/${gameId}/properties/sell-buildings`],
    ['mortgageProperty', (id?: string) => monopolyBankApi.mortgageProperty(gameId, space, id), `/api/games/${gameId}/properties/mortgage`],
    ['unmortgageProperty', (id?: string) => monopolyBankApi.unmortgageProperty(gameId, space, id), `/api/games/${gameId}/properties/unmortgage`],
    ['recordAuction', (id?: string) => monopolyBankApi.recordAuction(gameId, { boardSpaceId: space.boardSpaceId, winnerPlayerId: playerId, price: 999 }, id), `/api/games/${gameId}/properties/auction`],
    ['proposeTrade', (id?: string) => monopolyBankApi.proposeTrade(gameId, { proposerPlayerId: playerId, responderPlayerId: playerId, cashFromProposer: 10 }, id), `/api/games/${gameId}/trades`],
    ['acceptTrade', (id?: string) => monopolyBankApi.acceptTrade(gameId, 'trade-1', id), `/api/games/${gameId}/trades/trade-1/accept`],
    ['declineTrade', (id?: string) => monopolyBankApi.declineTrade(gameId, 'trade-1', id), `/api/games/${gameId}/trades/trade-1/decline`],
    ['cancelTrade', (id?: string) => monopolyBankApi.cancelTrade(gameId, 'trade-1', id), `/api/games/${gameId}/trades/trade-1/cancel`],
    ['payJailBail', (id?: string) => monopolyBankApi.payJailBail(gameId, { playerId }, id), `/api/games/${gameId}/jail/bail`],
    ['recordDiceRoll', (id?: string) => monopolyBankApi.recordDiceRoll(gameId, { playerId, first: 3, second: 3 }, id), `/api/games/${gameId}/dice-rolls`],
  ])('%s posts with the caller’s command id, or a fresh one', async (_name, call, path) => {
    const calls = captureFetch({});

    await call(commandId);
    await call();

    expect(calls).toHaveLength(2);
    for (const { url, init } of calls) {
      expect(url).toBe(path);
      expect(init.method).toBe('POST');
    }
    expect(new Headers(calls[0].init.headers).get('x-command-id')).toBe(commandId);
    expect(new Headers(calls[1].init.headers).get('x-command-id')).toMatch(commandIdPattern);
    expect(new Headers(calls[1].init.headers).get('x-command-id')).not.toBe(commandId);
  });

  it('serialises the request body as JSON', async () => {
    const calls = captureFetch({});

    await monopolyBankApi.recordDiceRoll(gameId, { playerId, first: 6, second: 6 }, commandId);

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ playerId, first: 6, second: 6 });
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
  });
});
