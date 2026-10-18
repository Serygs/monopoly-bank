import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from './services/errors.js';
import {
  AUCTION,
  G,
  START,
  U,
  gameDetails,
  harness,
  json,
  sentTo,
  socket,
  type FakeSocket,
} from './test-support/game-session-harness.js';

const pending = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('./repositories/trade-request-repository.js', () => ({
  D1TradeRequestRepository: class {
    listPendingForPlayers(gameId: string, playerIds: readonly string[]): Promise<unknown> {
      return Promise.resolve(pending.list(gameId, playerIds));
    }
  },
}));

const UPGRADE = { 'x-game-id': G, 'x-user-id': U, upgrade: 'websocket' };
const connect = (headers: Record<string, string>) =>
  new Request('https://game-session/connect', { headers });

interface Upgraded {
  status: number;
  requestId: string | null;
  webSocket: unknown;
}

describe('the WebSocket upgrade decision', () => {
  const upgrades: Upgraded[] = [];
  const client = { role: 'client' };
  let server: FakeSocket;

  beforeEach(() => {
    upgrades.length = 0;
    server = socket(null);
    class FakePair {
      0 = client;
      1 = server;
    }
    class UpgradeResponse extends Response {
      constructor(body: BodyInit | null, init: ResponseInit & { webSocket?: unknown }) {
        super(body, { ...init, status: init.status === 101 ? 200 : init.status });
        upgrades.push({
          status: init.status ?? 200,
          requestId: new Headers(init.headers).get('x-request-id'),
          webSocket: init.webSocket,
        });
      }
    }
    vi.stubGlobal('WebSocketPair', FakePair);
    vi.stubGlobal('Response', UpgradeResponse);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    pending.list.mockReset();
  });

  it('refuses anything that is not an upgrade request with 426 and the request id', async () => {
    const { session, context } = harness();
    for (const upgrade of [undefined, '', 'h2c']) {
      const headers: Record<string, string> = {
        'x-game-id': G,
        'x-user-id': U,
        'x-request-id': 'req-426',
      };
      if (upgrade !== undefined) headers.upgrade = upgrade;
      const response = await session.fetch(connect(headers));
      expect(response.status).toBe(426);
      expect(response.headers.get('x-request-id')).toBe('req-426');
      expect((await json(response)).error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'WebSocket upgrade required.',
        requestId: 'req-426',
      });
    }
    expect(context.acceptWebSocket).not.toHaveBeenCalled();
  });

  it('generates a request id when the gateway sent none', async () => {
    const { session } = harness();
    const response = await session.fetch(connect({ 'x-game-id': G, 'x-user-id': U }));
    const header = response.headers.get('x-request-id');
    expect(header).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect((await json(response)).error.requestId).toBe(header);
  });

  it('refuses a finished game with 409 before looking at membership or accepting a socket', async () => {
    const { session, gameService, access, context } = harness();
    gameService.getGame.mockResolvedValue(gameDetails('FINISHED'));
    const response = await session.fetch(connect({ ...UPGRADE, 'x-request-id': 'req-409' }));
    expect(response.status).toBe(409);
    expect(response.headers.get('x-request-id')).toBe('req-409');
    expect((await json(response)).error).toEqual({
      code: 'GAME_FINISHED',
      message: 'This game is finished.',
      requestId: 'req-409',
    });
    expect(access.requireMember).not.toHaveBeenCalled();
    expect(context.acceptWebSocket).not.toHaveBeenCalled();
  });

  it('does not accept a socket for a non-member and surfaces the refusal', async () => {
    const { session, access, context, sockets } = harness({ sockets: [] });
    access.requireMember.mockRejectedValue(new ForbiddenError());
    await expect(session.fetch(connect(UPGRADE))).rejects.toBeInstanceOf(ForbiddenError);
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
    expect(context.acceptWebSocket).not.toHaveBeenCalled();
    expect(sockets).toEqual([]);
  });

  it('does not accept a socket when the game cannot be loaded', async () => {
    const { session, gameService, context } = harness();
    gameService.getGame.mockRejectedValue(new Error('D1 unavailable'));
    await expect(session.fetch(connect(UPGRADE))).rejects.toThrow('D1 unavailable');
    expect(context.acceptWebSocket).not.toHaveBeenCalled();
  });

  it('accepts a member: tags the socket with the user, sends the snapshot, then the presence', async () => {
    const { session, context, sockets, storage, access, transactions } = harness({
      sockets: [],
      stored: { stateVersion: 5 },
    });
    access.controlledWallets.mockResolvedValue([{ playerId: P1WALLET }, { playerId: P2WALLET }]);
    transactions.listByGameId.mockResolvedValue([{ id: 'tx-1' }]);
    const response = await session.fetch(connect({ ...UPGRADE, 'x-request-id': 'req-101' }));
    expect(response.status).toBe(200);
    expect(upgrades).toEqual([{ status: 101, requestId: 'req-101', webSocket: client }]);
    expect(server.serializeAttachment).toHaveBeenCalledWith({ userId: U });
    expect(context.acceptWebSocket).toHaveBeenCalledWith(server, [U]);
    expect(sockets).toEqual([server]);
    expect(transactions.listByGameId).toHaveBeenCalledWith(G, 50);
    expect(sentTo(server)).toEqual([
      {
        type: 'GAME_SNAPSHOT',
        state: {
          stateVersion: 5,
          details: {
            ...gameDetails(),
            controlledWallets: [{ playerId: P1WALLET }, { playerId: P2WALLET }],
            controlledPlayerIds: [P1WALLET, P2WALLET],
          },
          transactions: [{ id: 'tx-1' }],
        },
      },
      { type: 'PRESENCE_UPDATED', stateVersion: 5, connectedActors: 0 },
    ]);
    expect(storage.get('stateVersion')).toBe(5);
  });

  it('counts the new connection as present once its attachment is readable', async () => {
    const { session, sockets } = harness({ sockets: [socket({ userId: 'other' })] });
    server.deserializeAttachment = () => ({ userId: U });
    await session.fetch(connect(UPGRADE));
    expect(sentTo(sockets[0] as FakeSocket)).toEqual([
      { type: 'PRESENCE_UPDATED', stateVersion: 0, connectedActors: 2 },
    ]);
  });

  it('reuses the game it already loaded instead of reading it again', async () => {
    const { session, gameService } = harness();
    await session.fetch(connect(UPGRADE));
    expect(gameService.getGame).toHaveBeenCalledTimes(1);
  });

  it('adds the pending trade requests of the wallets the user controls in a board game', async () => {
    const { session, gameService, access } = harness({ sockets: [] });
    const board = {
      game: { id: G, status: 'ACTIVE', rules: {}, settings: { board: { id: 'x' } } },
    };
    gameService.getGame.mockResolvedValue({ ...gameDetails('ACTIVE'), ...board });
    access.controlledWallets.mockResolvedValue([{ playerId: P1WALLET }]);
    pending.list.mockReturnValue([{ id: 'trade-1' }]);
    await session.fetch(connect(UPGRADE));
    expect(pending.list).toHaveBeenCalledWith(G, [P1WALLET]);
    const snapshot = sentTo(server)[0] as { state: { details: { tradeRequests: unknown } } };
    expect(snapshot.state.details.tradeRequests).toEqual([{ id: 'trade-1' }]);
  });

  it('leaves trade requests out without a board', async () => {
    const { session, gameService } = harness({ sockets: [] });
    gameService.getGame.mockResolvedValue({
      ...gameDetails('ACTIVE'),
      game: { id: G, status: 'ACTIVE', rules: {}, settings: { board: null } },
    });
    await session.fetch(connect(UPGRADE));
    const snapshot = sentTo(server)[0] as { state: { details: Record<string, unknown> } };
    expect(snapshot.state.details).not.toHaveProperty('tradeRequests');
    expect(pending.list).not.toHaveBeenCalled();
  });

  it('arms a running auction whose deadline storage lost, so the snapshot cannot leave it stuck', async () => {
    const endsAt = new Date(START + 30_000).toISOString();
    const { session, gameService, storage, alarm } = harness({ sockets: [] });
    gameService.getGame.mockResolvedValue({
      ...gameDetails('ACTIVE'),
      auction: { id: AUCTION, state: 'ACTIVE', endsAt },
    });
    await session.fetch(connect(UPGRADE));
    expect(storage.get('auctionDeadline')).toEqual({
      gameId: G,
      auctionId: AUCTION,
      endsAt: START + 30_000,
    });
    expect(alarm()).toBe(START + 30_000);
  });

  it('keeps the stored deadline of a running auction, and ignores a closed one', async () => {
    const endsAt = new Date(START + 30_000).toISOString();
    const stored = { gameId: G, auctionId: 'kept', endsAt: START + 99_000 };
    const kept = harness({ sockets: [], stored: { auctionDeadline: stored } });
    kept.gameService.getGame.mockResolvedValue({
      ...gameDetails('ACTIVE'),
      auction: { id: AUCTION, state: 'ACTIVE', endsAt },
    });
    kept.auctions.getCurrent.mockResolvedValue({ id: 'kept', state: 'ACTIVE', endsAt });
    await kept.session.fetch(connect(UPGRADE));
    expect(kept.storage.get('auctionDeadline')).toEqual(stored);

    const closed = harness({ sockets: [] });
    closed.gameService.getGame.mockResolvedValue({
      ...gameDetails('ACTIVE'),
      auction: { id: AUCTION, state: 'SOLD', endsAt },
    });
    await closed.session.fetch(connect(UPGRADE));
    expect(closed.storage.has('auctionDeadline')).toBe(false);
    expect(closed.alarm()).toBeNull();
  });

  it('settles a due auction before it builds the snapshot', async () => {
    const endsAt = new Date(START + 30_000).toISOString();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 31_000);
    try {
      const observer = socket({ userId: 'other' });
      const { session, auctions } = harness({
        sockets: [observer],
        stored: { auctionDeadline: { gameId: G, auctionId: AUCTION, endsAt: START + 30_000 } },
      });
      auctions.settleDue.mockResolvedValue({
        auction: { id: AUCTION, state: 'NO_SALE', endsAt },
      });
      await session.fetch(connect(UPGRADE));
      expect(auctions.settleDue).toHaveBeenCalledWith(G, AUCTION);
      expect(sentTo(observer).map((event) => event.type)).toEqual([
        'AUCTION_UPDATED',
        'PRESENCE_UPDATED',
      ]);
      expect(sentTo(server).map((event) => event.type)).toEqual([
        'GAME_SNAPSHOT',
        'PRESENCE_UPDATED',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still connects when settling the auction fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 31_000);
    try {
      const { session, auctions } = harness({
        sockets: [],
        stored: { auctionDeadline: { gameId: G, auctionId: AUCTION, endsAt: START + 30_000 } },
      });
      auctions.settleDue.mockRejectedValue(new Error('D1 unavailable'));
      const response = await session.fetch(connect(UPGRADE));
      expect(response.status).toBe(200);
      expect(upgrades).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const P1WALLET = '00000000-0000-4000-8000-0000000000a1';
const P2WALLET = '00000000-0000-4000-8000-0000000000a2';

describe('the auction polling route', () => {
  const read = (headers: Record<string, string> = {}) =>
    new Request('https://game-session/auction', {
      headers: { 'x-game-id': G, 'x-user-id': U, ...headers },
    });

  it('returns the current auction and echoes the request id', async () => {
    const { session, auctions, access } = harness();
    auctions.getCurrent.mockResolvedValue({ id: AUCTION, state: 'ACTIVE' });
    const response = await session.fetch(read({ 'x-request-id': 'req-a' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-a');
    expect(await json(response)).toEqual({ data: { auction: { id: AUCTION, state: 'ACTIVE' } } });
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
  });

  it('answers with a generated request id when none was sent, and a null auction when there is none', async () => {
    const { session } = harness();
    const response = await session.fetch(read());
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await response.json()).toEqual({ data: { auction: null } });
  });

  it('prefers the auction it just settled and returns the payment with it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START + 31_000);
    try {
      const { session, auctions } = harness({
        stored: { auctionDeadline: { gameId: G, auctionId: AUCTION, endsAt: START + 30_000 } },
      });
      auctions.getCurrent.mockResolvedValue({ id: 'stale', state: 'ACTIVE' });
      auctions.settleDue.mockResolvedValue({
        auction: { id: AUCTION, state: 'SOLD' },
        transaction: { id: 'tx' },
        players: [],
      });
      const response = await session.fetch(read());
      expect(await response.json()).toEqual({
        data: { auction: { id: AUCTION, state: 'SOLD' }, transaction: { id: 'tx' }, players: [] },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a non-member with the error envelope, without reading the auction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { session, auctions, access } = harness();
      access.requireMember.mockRejectedValue(new ForbiddenError());
      const response = await session.fetch(read({ 'x-request-id': 'req-f' }));
      expect(response.status).toBe(403);
      expect((await json(response)).error).toMatchObject({
        code: 'FORBIDDEN',
        requestId: 'req-f',
      });
      expect(auctions.getCurrent).not.toHaveBeenCalled();
      const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(logged).toMatchObject({ path: '/auction', gameId: G, userId: U, requestId: 'req-f' });
    } finally {
      warn.mockRestore();
    }
  });

  it('turns an unexpected failure into a generic 500 that leaks nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { session, auctions } = harness();
      auctions.getCurrent.mockRejectedValue(new Error('secret D1 detail'));
      const response = await session.fetch(read());
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('secret D1 detail');
    } finally {
      error.mockRestore();
    }
  });
});
