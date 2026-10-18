import { describe, expect, it, vi, type Mock } from 'vitest';
import { GameSession } from './game-session.js';
import { ForbiddenError } from './services/errors.js';

const G = '00000000-0000-4000-8000-000000000001';
const U = 'user-1';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const R = '00000000-0000-4000-8000-0000000000b1';
const CMD = '00000000-0000-4000-8000-0000000000c1';
const CMD2 = '00000000-0000-4000-8000-0000000000c2';
const AUCTION = '00000000-0000-4000-8000-0000000000d1';

type Fn = Mock<(...args: unknown[]) => unknown>;
const fns = (...names: string[]): Record<string, Fn> =>
  Object.fromEntries(names.map((name) => [name, vi.fn(async () => undefined)]));

interface Seams {
  mutate(gameId: string, userId: string, request: Request): Promise<Response>;
  fetch(request: Request): Promise<Response>;
  webSocketMessage(ws: Socket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(): Promise<void>;
  access(): unknown;
  banking(commandId: string): unknown;
  gameService(): unknown;
  auctions(): unknown;
  commandLedger(): unknown;
  finishGame(gameId: string, winners: string[]): Promise<unknown>;
}
interface Socket {
  send: Fn;
  close: Fn;
  deserializeAttachment(): unknown;
}

const socket = (attachment: unknown = { userId: U }): Socket => ({
  send: vi.fn(),
  close: vi.fn(),
  deserializeAttachment: () => attachment,
});
const sentTo = (ws: Socket): Array<Record<string, unknown>> =>
  ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);

const gameDetails = (status = 'LOBBY') => ({
  game: { id: G, status, rules: { bankLoans: false } },
  players: [{ id: P1 }, { id: P2 }],
});

function setup(options: { sockets?: Socket[]; stored?: Record<string, unknown> } = {}) {
  const sockets = options.sockets ?? [socket()];
  const storage = new Map<string, unknown>(Object.entries(options.stored ?? {}));
  let alarm: number | null = null;
  const context = {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => storage.delete(key),
      setAlarm: async (time: number) => {
        alarm = time;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
    getWebSockets: () => sockets,
  };
  const session = new GameSession(context as never, {} as Env) as unknown as Seams;
  const access = fns(
    'requireOwner',
    'requireMember',
    'requireLobbySeat',
    'requirePlayerController',
    'requireReversalAuthority',
    'joinLobby',
    'removeLobbyPlayer',
    'controlledWallets',
    'linkedMembers',
  );
  const banking = fns(
    'createTransaction',
    'acceptPaymentRequest',
    'declinePaymentRequest',
    'cancelPaymentRequest',
    'getPaymentRequest',
    'createTradeRequest',
    'acceptTradeRequest',
    'declineTradeRequest',
    'cancelTradeRequest',
    'getTradeRequest',
    'declareBankruptcy',
    'getTransaction',
  );
  const gameService = fns('startGame', 'getGame');
  gameService.getGame = vi.fn(async () => gameDetails());
  gameService.startGame = vi.fn(async () => gameDetails('ACTIVE'));
  const auctions = fns('startAuction', 'placeBid', 'getCurrent', 'settleDue');
  const claimed = new Map<string, 'PENDING' | 'COMPLETED'>();
  const results = new Map<string, { status: number; result: unknown }>();
  const completed: Array<Record<string, unknown>> = [];
  const ledger = {
    claim: vi.fn(async (input: { commandId: string }) => {
      const stored = results.get(input.commandId);
      return {
        ...input,
        status: claimed.get(input.commandId) ?? 'PENDING',
        resultStatus: stored?.status ?? 200,
        resultJson: JSON.stringify(stored?.result ?? { replayed: true }),
      };
    }),
    complete: vi.fn(async (input: { commandId: string; status: number; result: unknown }) => {
      claimed.set(input.commandId, 'COMPLETED');
      results.set(input.commandId, { status: input.status, result: input.result });
      completed.push(input);
    }),
  };
  session.access = () => access;
  session.banking = () => banking;
  session.gameService = () => gameService;
  session.auctions = () => auctions;
  session.commandLedger = () => ledger;
  const finishGame = vi.fn(async () => gameDetails('FINISHED'));
  session.finishGame = finishGame;
  return {
    session,
    sockets,
    storage,
    alarm: () => alarm,
    access,
    banking,
    gameService,
    auctions,
    ledger,
    claimed,
    completed,
    finishGame,
  };
}

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request('https://game-session/mutation', {
    method: 'POST',
    headers,
    body: JSON.stringify({ commandId: CMD, ...body }),
  });
interface Body {
  data?: unknown;
  error: { code: string; message: string; requestId?: string };
}
const json = async (response: Response) => (await response.json()) as Body;

describe('the live socket protocol', () => {
  it('closes a connection that sends binary data', async () => {
    const { session } = setup();
    const ws = socket();
    await session.webSocketMessage(ws, new ArrayBuffer(4));
    expect(ws.close).toHaveBeenCalledWith(1008, 'Invalid live protocol message.');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it.each([
    'not json',
    '',
    'null',
    '5',
    '[]',
    JSON.stringify({ type: 'CREATE_TRANSACTION' }),
    JSON.stringify({ type: 'HEARTBEAT', extra: 1 }),
    JSON.stringify({ type: 'heartbeat' }),
    JSON.stringify({}),
  ])('closes a connection that sends %j, because commands use the API', async (message) => {
    const { session } = setup();
    const ws = socket();
    await session.webSocketMessage(ws, message);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Commands must use the authenticated API.');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('answers a heartbeat with the current state version', async () => {
    const { session } = setup({ stored: { stateVersion: 7 } });
    const ws = socket();
    await session.webSocketMessage(ws, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(sentTo(ws)).toEqual([{ type: 'HEARTBEAT', stateVersion: 7 }]);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('reads the legacy version key, and zero when there is none', async () => {
    const legacy = setup({ stored: { version: 4 } });
    const a = socket();
    await legacy.session.webSocketMessage(a, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(sentTo(a)).toEqual([{ type: 'HEARTBEAT', stateVersion: 4 }]);
    const fresh = setup();
    const b = socket();
    await fresh.session.webSocketMessage(b, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(sentTo(b)).toEqual([{ type: 'HEARTBEAT', stateVersion: 0 }]);
    const both = setup({ stored: { stateVersion: 9, version: 4 } });
    const c = socket();
    await both.session.webSocketMessage(c, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(sentTo(c)).toEqual([{ type: 'HEARTBEAT', stateVersion: 9 }]);
  });

  it('closes a socket that cannot be written to, and survives one that cannot even be closed', async () => {
    const { session } = setup();
    const broken = socket();
    broken.send.mockImplementation(() => {
      throw new Error('gone');
    });
    await session.webSocketMessage(broken, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(broken.close).toHaveBeenCalledWith(1011, 'Socket delivery failed.');
    const dead = socket();
    dead.send.mockImplementation(() => {
      throw new Error('gone');
    });
    dead.close.mockImplementation(() => {
      throw new Error('also gone');
    });
    await expect(
      session.webSocketMessage(dead, JSON.stringify({ type: 'HEARTBEAT' })),
    ).resolves.toBeUndefined();
  });

  it('tells every socket how many different people are connected when one closes', async () => {
    const sockets = [
      socket({ userId: 'a' }),
      socket({ userId: 'a' }),
      socket({ userId: 'b' }),
      socket({ userId: 7 }),
      socket(null),
      socket({}),
    ];
    const { session } = setup({ sockets, stored: { stateVersion: 3 } });
    await session.webSocketClose();
    for (const ws of sockets)
      expect(sentTo(ws)).toEqual([
        { type: 'PRESENCE_UPDATED', stateVersion: 3, connectedActors: 2 },
      ]);
  });

  it('counts nobody when nobody is connected', async () => {
    const { session } = setup({ sockets: [] });
    await expect(session.webSocketClose()).resolves.toBeUndefined();
  });
});

describe('the Durable Object routes', () => {
  const call = (
    session: Seams,
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
  ) => session.fetch(new Request(`https://game-session${path}`, { method, headers }));

  it('refuses a request that does not carry the game and the user', async () => {
    const { session } = setup();
    for (const headers of [{}, { 'x-game-id': G }, { 'x-user-id': U }]) {
      const response = await call(session, '/connect', { 'x-request-id': 'req-1', ...headers });
      expect(response.status).toBe(403);
      expect(response.headers.get('x-request-id')).toBe('req-1');
      expect(await response.json()).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not allowed to perform this operation.',
          requestId: 'req-1',
        },
      });
    }
  });

  it('answers an unknown path, or the wrong method for the auction, with 404', async () => {
    const { session } = setup();
    const headers = { 'x-game-id': G, 'x-user-id': U, 'x-request-id': 'req-2' };
    for (const [path, method] of [
      ['/nowhere', 'GET'],
      ['/auction', 'POST'],
    ] as const) {
      const response = await call(session, path, headers, method);
      expect(response.status).toBe(404);
      expect(response.headers.get('x-request-id')).toBe('req-2');
      expect(await response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId: 'req-2' },
      });
    }
  });

  it('asks for a WebSocket upgrade on the connect path', async () => {
    const { session } = setup();
    const response = await call(session, '/connect', { 'x-game-id': G, 'x-user-id': U });
    expect(response.status).toBe(426);
    expect((await json(response)).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'WebSocket upgrade required.',
    });
  });

  it('refuses to connect to a finished game before checking membership', async () => {
    const { session, gameService, access } = setup();
    gameService.getGame.mockResolvedValue(gameDetails('FINISHED'));
    const response = await call(session, '/connect', {
      'x-game-id': G,
      'x-user-id': U,
      upgrade: 'WebSocket',
    });
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({
      code: 'GAME_FINISHED',
      message: 'This game is finished.',
    });
    expect(access.requireMember).not.toHaveBeenCalled();
  });

  it('refuses to connect a user who is not a member', async () => {
    const { session, access } = setup();
    access.requireMember.mockRejectedValue(new Error('not a member'));
    await expect(
      call(session, '/connect', { 'x-game-id': G, 'x-user-id': U, upgrade: 'websocket' }),
    ).rejects.toThrow('not a member');
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
  });
});

describe('commands: validation and idempotency', () => {
  it.each([
    ['not json', 'nope'],
    ['an unknown type', JSON.stringify({ type: 'DROP_TABLE', commandId: CMD })],
    ['a missing command id', JSON.stringify({ type: 'START_GAME' })],
    ['a command id that is not a UUID v4', JSON.stringify({ type: 'START_GAME', commandId: 'x' })],
  ])('refuses %s with 400 and runs nothing', async (_label, body) => {
    const { session, gameService, ledger } = setup();
    const response = await session.mutate(
      G,
      U,
      new Request('https://game-session/mutation', { method: 'POST', body }),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('VALIDATION_ERROR');
    expect(gameService.startGame).not.toHaveBeenCalled();
    expect(ledger.claim).not.toHaveBeenCalled();
  });

  const gated = (access: Record<string, Fn>) => {
    let release: () => void = () => undefined;
    access.requireOwner.mockImplementation(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    return () => release();
  };

  const settleRace = async (
    a: Promise<Response>,
    b: Promise<Response>,
    release: () => void,
  ): Promise<Response[]> => {
    const first = await Promise.race([a, b]);
    release();
    const both = await Promise.all([a, b]);
    expect(both).toContain(first);
    return both;
  };

  it('refuses the same command id with another payload while the first is running', async () => {
    const { session, gameService, access } = setup();
    const release = gated(access);
    const responses = await settleRace(
      session.mutate(G, U, post({ type: 'START_GAME' })),
      session.mutate(G, U, post({ type: 'REMOVE_PLAYER', playerId: P1 })),
      release,
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409) as Response;
    expect((await json(refused)).error).toMatchObject({
      code: 'COMMAND_ID_REUSED',
      message: 'This command ID belongs to a different command.',
    });
    const executed =
      gameService.startGame.mock.calls.length + access.removeLobbyPlayer.mock.calls.length;
    expect(executed).toBe(1);
  });

  it('refuses the same command id from another user while the first is running', async () => {
    const { session, gameService, access } = setup();
    const release = gated(access);
    const responses = await settleRace(
      session.mutate(G, U, post({ type: 'START_GAME' })),
      session.mutate(G, 'user-2', post({ type: 'START_GAME' })),
      release,
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409) as Response;
    expect((await json(refused)).error.code).toBe('COMMAND_ID_REUSED');
    expect(gameService.startGame).toHaveBeenCalledTimes(1);
  });

  it('answers the same command from the same user while it is running with the same result', async () => {
    const { session, gameService, access } = setup();
    const release = gated(access);
    const first = session.mutate(G, U, post({ type: 'START_GAME' }));
    const second = session.mutate(G, U, post({ type: 'START_GAME' }));
    await new Promise((done) => setTimeout(done, 10));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect(gameService.startGame).toHaveBeenCalledTimes(1);
  });

  it('answers the same command arriving twice at once with one execution', async () => {
    const { session, gameService } = setup();
    const [a, b] = await Promise.all([
      session.mutate(G, U, post({ type: 'START_GAME' })),
      session.mutate(G, U, post({ type: 'START_GAME' })),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(gameService.startGame).toHaveBeenCalledTimes(1);
  });

  it('treats a payload with its keys in another order as the same command', async () => {
    const { session, banking, access } = setup();
    const hold = vi.fn();
    access.requirePlayerController.mockImplementation(
      () =>
        new Promise<void>((done) => {
          hold.mockImplementation(done);
        }),
    );
    banking.createTransaction.mockResolvedValue({ transaction: { id: 'tx' }, players: [] });
    const one = session.mutate(
      G,
      U,
      post({
        type: 'CREATE_TRANSACTION',
        request: { type: 'PLAYER_TO_BANK', playerId: P1, amount: 5 },
      }),
    );
    const two = session.mutate(
      G,
      U,
      post({
        request: { amount: 5, playerId: P1, type: 'PLAYER_TO_BANK' },
        type: 'CREATE_TRANSACTION',
      }),
    );
    await new Promise((done) => setTimeout(done, 10));
    hold();
    const [a, b] = await Promise.all([one, two]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(banking.createTransaction).toHaveBeenCalledTimes(1);
  });

  it('replays the stored result of a completed command without executing or announcing it', async () => {
    const { session, claimed, gameService, sockets, access } = setup();
    claimed.set(CMD, 'COMPLETED');
    const response = await session.mutate(G, U, post({ type: 'START_GAME' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { replayed: true } });
    expect(gameService.startGame).not.toHaveBeenCalled();
    expect(access.requireOwner).not.toHaveBeenCalled();
    expect(sentTo(sockets[0] as Socket)).toEqual([]);
  });

  it('echoes the request id of the caller', async () => {
    const { session } = setup();
    const response = await session.mutate(
      G,
      U,
      post({ type: 'START_GAME' }, { 'x-request-id': 'req-9' }),
    );
    expect(response.headers.get('x-request-id')).toBe('req-9');
  });

  it('does not run, count or announce a command the user may not issue', async () => {
    const { session, access, gameService, sockets, ledger } = setup({
      stored: { stateVersion: 4 },
    });
    access.requireOwner.mockRejectedValue(new ForbiddenError());
    const response = await session.mutate(G, U, post({ type: 'START_GAME' }));
    expect(response.status).toBe(403);
    expect(gameService.startGame).not.toHaveBeenCalled();
    expect(ledger.complete).not.toHaveBeenCalled();
    expect(sentTo(sockets[0] as Socket)).toEqual([]);
    const heartbeat = socket();
    await session.webSocketMessage(heartbeat, JSON.stringify({ type: 'HEARTBEAT' }));
    expect(sentTo(heartbeat)).toEqual([{ type: 'HEARTBEAT', stateVersion: 4 }]);
  });

  it('records the result, the status and the transaction id in the ledger and bumps the version once', async () => {
    const { session, banking, completed, sockets } = setup({ stored: { stateVersion: 4 } });
    banking.createTransaction.mockResolvedValue({ transaction: { id: 'tx-1' }, players: [] });
    await session.mutate(
      G,
      U,
      post({
        type: 'CREATE_TRANSACTION',
        request: { type: 'PLAYER_TO_BANK', playerId: P1, amount: 5 },
      }),
    );
    expect(completed).toEqual([
      {
        gameId: G,
        commandId: CMD,
        status: 201,
        result: { transaction: { id: 'tx-1' }, players: [] },
        transactionId: 'tx-1',
      },
    ]);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      expect.objectContaining({ type: 'GAME_COMMITTED', stateVersion: 5 }),
    ]);
  });

  it('stores no transaction id for a result that has none', async () => {
    const { session, completed } = setup();
    await session.mutate(G, U, post({ type: 'START_GAME' }));
    expect(completed[0]).toMatchObject({ transactionId: null, status: 200 });
  });
});

describe('lobby commands', () => {
  it('lets only the owner start a game and announces the lobby to everyone', async () => {
    const { session, access, gameService, sockets } = setup();
    const response = await session.mutate(G, U, post({ type: 'START_GAME' }));
    expect(response.status).toBe(200);
    expect(access.requireOwner).toHaveBeenCalledWith(G, U);
    expect(gameService.startGame).toHaveBeenCalledWith(G);
    expect(await response.json()).toEqual({ data: gameDetails('ACTIVE') });
    expect(sentTo(sockets[0] as Socket)).toEqual([
      {
        type: 'LOBBY_UPDATED',
        stateVersion: 1,
        details: { game: gameDetails('ACTIVE').game, players: gameDetails('ACTIVE').players },
      },
    ]);
  });

  it('seats a player in an open lobby and returns the lobby with 201', async () => {
    const { session, access, gameService } = setup();
    const response = await session.mutate(
      G,
      U,
      post({
        type: 'JOIN_LOBBY',
        playerId: P1,
        nickname: 'Ada',
        color: '#fff',
        startingBalance: 1500,
      }),
    );
    expect(response.status).toBe(201);
    expect(access.requireLobbySeat).toHaveBeenCalledWith(G, U, 2);
    expect(access.joinLobby).toHaveBeenCalledWith({
      gameId: G,
      userId: U,
      playerId: P1,
      nickname: 'Ada',
      color: '#fff',
      startingBalance: 1500,
    });
    expect(gameService.getGame).toHaveBeenCalledWith(G);
  });

  it('refuses a seat in a lobby that has closed', async () => {
    const { session, access, gameService } = setup();
    gameService.getGame.mockResolvedValue(gameDetails('ACTIVE'));
    const response = await session.mutate(
      G,
      U,
      post({
        type: 'JOIN_LOBBY',
        playerId: P1,
        nickname: 'Ada',
        color: '#fff',
        startingBalance: 1500,
      }),
    );
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe('LOBBY_CLOSED');
    expect(access.requireLobbySeat).not.toHaveBeenCalled();
    expect(access.joinLobby).not.toHaveBeenCalled();
  });

  it('lets only the owner remove a player', async () => {
    const { session, access } = setup();
    const response = await session.mutate(G, U, post({ type: 'REMOVE_PLAYER', playerId: P1 }));
    expect(response.status).toBe(200);
    expect(access.requireOwner).toHaveBeenCalledWith(G, U);
    expect(access.removeLobbyPlayer).toHaveBeenCalledWith(G, U, P1);
  });

  it('lets only the owner finish a game and announces the end', async () => {
    const { session, access, finishGame, sockets } = setup();
    const response = await session.mutate(
      G,
      U,
      post({ type: 'FINISH_GAME', winnerPlayerIds: [P1] }),
    );
    expect(response.status).toBe(200);
    expect(access.requireOwner).toHaveBeenCalledWith(G, U);
    expect(finishGame).toHaveBeenCalledWith(G, [P1]);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      { type: 'GAME_FINISHED', stateVersion: 1, details: gameDetails('FINISHED') },
    ]);
  });
});

describe('auction commands', () => {
  const active = { id: AUCTION, state: 'ACTIVE', endsAt: '2026-01-01T00:00:30.000Z' };

  it('starts an auction for a wallet the user controls, arms the alarm and announces it', async () => {
    const { session, access, auctions, storage, alarm, sockets } = setup();
    auctions.startAuction.mockResolvedValue({ auction: active });
    const request = { initiatorPlayerId: P1, lotName: 'Lot' };
    const response = await session.mutate(G, U, post({ type: 'START_AUCTION', request }));
    expect(response.status).toBe(201);
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, P1);
    expect(auctions.startAuction).toHaveBeenCalledWith(G, request, CMD);
    expect(alarm()).toBe(Date.parse(active.endsAt));
    expect(storage.get('auctionDeadline')).toEqual({
      gameId: G,
      auctionId: AUCTION,
      endsAt: Date.parse(active.endsAt),
    });
    expect(sentTo(sockets[0] as Socket)).toEqual([
      { type: 'AUCTION_UPDATED', stateVersion: 1, auction: active },
    ]);
  });

  it('does not arm the alarm for an auction that is not running', async () => {
    const { session, auctions, storage, alarm } = setup();
    auctions.startAuction.mockResolvedValue({ auction: { ...active, state: 'SOLD' } });
    await session.mutate(
      G,
      U,
      post({ type: 'START_AUCTION', request: { initiatorPlayerId: P1, lotName: 'Lot' } }),
    );
    expect(alarm()).toBeNull();
    expect(storage.has('auctionDeadline')).toBe(false);
  });

  it('places a bid for a wallet the user controls and moves the alarm to the new end', async () => {
    const { session, access, auctions, alarm } = setup();
    const later = { ...active, endsAt: '2026-01-01T00:00:40.000Z' };
    auctions.placeBid.mockResolvedValue({ auction: later });
    const request = { bidderPlayerId: P2, auctionId: AUCTION, expectedVersion: 1, step: 25 };
    const response = await session.mutate(G, U, post({ type: 'PLACE_BID', request }));
    expect(response.status).toBe(200);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, P2);
    expect(auctions.placeBid).toHaveBeenCalledWith(G, request);
    expect(alarm()).toBe(Date.parse(later.endsAt));
  });

  it('refuses an auction command for a wallet the user does not control', async () => {
    const { session, access, auctions } = setup();
    access.requirePlayerController.mockRejectedValue(new ForbiddenError());
    const response = await session.mutate(
      G,
      U,
      post({
        type: 'PLACE_BID',
        request: { bidderPlayerId: P2, auctionId: AUCTION, expectedVersion: 1, step: 25 },
      }),
    );
    expect(response.status).toBe(403);
    expect(auctions.placeBid).not.toHaveBeenCalled();
  });
});

describe('transaction commands', () => {
  const pay = { type: 'PLAYER_TO_PLAYER', sourcePlayerId: P1, destinationPlayerId: P2, amount: 5 };

  it('checks membership and control of the paying wallet, then creates the transaction with 201', async () => {
    const { session, access, banking, sockets } = setup();
    banking.createTransaction.mockResolvedValue({
      transaction: { id: 'tx' },
      players: [{ id: P1 }],
      mortgages: [],
      loans: [{ id: 'l' }],
      bankLoanCooldowns: [{ playerId: P1, roundsLeft: 1 }],
      jackpot: 0,
      properties: [{ tileId: 'a' }],
    });
    const response = await session.mutate(G, U, post({ type: 'CREATE_TRANSACTION', request: pay }));
    expect(response.status).toBe(201);
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, P1);
    expect(banking.createTransaction).toHaveBeenCalledWith(G, pay);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      {
        type: 'GAME_COMMITTED',
        stateVersion: 1,
        transaction: { id: 'tx' },
        players: [{ id: P1 }],
        mortgages: [],
        loans: [{ id: 'l' }],
        bankLoanCooldowns: [{ playerId: P1, roundsLeft: 1 }],
        jackpot: 0,
        properties: [{ tileId: 'a' }],
      },
    ]);
  });

  it('leaves out of the event every part the result does not carry', async () => {
    const { session, banking, sockets } = setup();
    banking.createTransaction.mockResolvedValue({ transaction: { id: 'tx' }, players: [] });
    await session.mutate(G, U, post({ type: 'CREATE_TRANSACTION', request: pay }));
    const event = sentTo(sockets[0] as Socket)[0] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['players', 'stateVersion', 'transaction', 'type']);
  });

  it('announces pending payment requests instead of a commit when confirmation is needed', async () => {
    const { session, banking, sockets } = setup();
    banking.createTransaction.mockResolvedValue({ paymentRequests: [{ id: R }], players: [] });
    await session.mutate(G, U, post({ type: 'CREATE_TRANSACTION', request: pay }));
    expect(sentTo(sockets[0] as Socket)).toEqual([
      { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 },
    ]);
  });

  it('checks reversal authority against the stored transaction instead of wallet control', async () => {
    const { session, access, banking } = setup();
    banking.getTransaction.mockResolvedValue({ id: R });
    banking.createTransaction.mockResolvedValue({ transaction: { id: 'rev' }, players: [] });
    await session.mutate(
      G,
      U,
      post({ type: 'CREATE_TRANSACTION', request: { type: 'REVERSAL', transactionId: R } }),
    );
    expect(banking.getTransaction).toHaveBeenCalledWith(G, R);
    expect(access.requireReversalAuthority).toHaveBeenCalledWith(G, U, { id: R });
    expect(access.requirePlayerController).not.toHaveBeenCalled();
  });

  it('refuses to reverse a transaction that does not exist', async () => {
    const { session, banking } = setup();
    banking.getTransaction.mockResolvedValue(null);
    const response = await session.mutate(
      G,
      U,
      post({ type: 'CREATE_TRANSACTION', request: { type: 'REVERSAL', transactionId: R } }),
    );
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe('TRANSACTION_NOT_FOUND');
    expect(banking.createTransaction).not.toHaveBeenCalled();
  });

  it('declares bankruptcy for the wallet of the user and says who went bankrupt', async () => {
    const { session, access, banking, sockets } = setup();
    banking.declareBankruptcy.mockResolvedValue({ transaction: { id: 'b' }, players: [] });
    const request = { playerId: P1, creditorPlayerId: P2 };
    const response = await session.mutate(G, U, post({ type: 'DECLARE_BANKRUPTCY', request }));
    expect(response.status).toBe(201);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, P1);
    expect(banking.declareBankruptcy).toHaveBeenCalledWith(G, request);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      expect.objectContaining({ type: 'GAME_COMMITTED', bankruptPlayerId: P1 }),
      { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 },
    ]);
  });

  it('also announces the running auction after a bankruptcy, because a bid may have been withdrawn', async () => {
    const { session, banking, auctions, sockets } = setup({
      stored: { auctionDeadline: { gameId: G, auctionId: AUCTION, endsAt: Date.now() + 60_000 } },
    });
    banking.declareBankruptcy.mockResolvedValue({ transaction: { id: 'b' }, players: [] });
    auctions.getCurrent.mockResolvedValue({ id: AUCTION, state: 'ACTIVE', currentBid: 0 });
    await session.mutate(G, U, post({ type: 'DECLARE_BANKRUPTCY', request: { playerId: P1 } }));
    expect(auctions.getCurrent).toHaveBeenCalledWith(G);
    expect(sentTo(sockets[0] as Socket).map((event) => event.type)).toEqual([
      'GAME_COMMITTED',
      'PAYMENT_REQUESTS_UPDATED',
      'AUCTION_UPDATED',
    ]);
  });
});

describe('payment request commands', () => {
  const stored = { id: R, approverPlayerId: P2, creatorPlayerId: P1 };

  it.each([
    ['ACCEPT_PAYMENT_REQUEST', 'acceptPaymentRequest', P2],
    ['DECLINE_PAYMENT_REQUEST', 'declinePaymentRequest', P2],
    ['CANCEL_PAYMENT_REQUEST', 'cancelPaymentRequest', P1],
  ] as const)('%s needs the wallet that may answer it', async (type, method, controlled) => {
    const { session, access, banking, sockets } = setup();
    banking.getPaymentRequest.mockResolvedValue(stored);
    banking[method]?.mockResolvedValue({ paymentRequest: stored, players: [] });
    const response = await session.mutate(G, U, post({ type, paymentRequestId: R }));
    expect(response.status).toBe(200);
    expect(banking.getPaymentRequest).toHaveBeenCalledWith(G, R);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, controlled);
    expect(banking[method]).toHaveBeenCalledWith(G, R);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 },
    ]);
  });

  it('commits the transaction an accepted request wrote, then refreshes the requests', async () => {
    const { session, banking, sockets } = setup();
    banking.getPaymentRequest.mockResolvedValue(stored);
    banking.acceptPaymentRequest.mockResolvedValue({
      paymentRequest: stored,
      transaction: { id: 'tx' },
      players: [{ id: P1 }],
    });
    await session.mutate(G, U, post({ type: 'ACCEPT_PAYMENT_REQUEST', paymentRequestId: R }));
    expect(sentTo(sockets[0] as Socket).map((event) => event.type)).toEqual([
      'GAME_COMMITTED',
      'PAYMENT_REQUESTS_UPDATED',
    ]);
  });

  it.each(['ACCEPT_PAYMENT_REQUEST', 'DECLINE_PAYMENT_REQUEST', 'CANCEL_PAYMENT_REQUEST'] as const)(
    '%s for a request that does not exist is a validation error',
    async (type) => {
      const { session, banking } = setup();
      banking.getPaymentRequest.mockResolvedValue(null);
      const response = await session.mutate(G, U, post({ type, paymentRequestId: R }));
      expect(response.status).toBe(400);
      expect((await json(response)).error.message).toBe('Payment request not found.');
    },
  );
});

describe('trade request commands', () => {
  const stored = { id: R, proposerPlayerId: P1, counterpartyPlayerId: P2 };
  const proposal = {
    id: R,
    playerId: P1,
    counterpartyPlayerId: P2,
    giveTileIds: ['a'],
    takeTileIds: [],
  };

  it('proposes a trade from a wallet the user controls with 201', async () => {
    const { session, access, banking, sockets } = setup();
    banking.createTradeRequest.mockResolvedValue({ tradeRequest: stored });
    const response = await session.mutate(
      G,
      U,
      post({ type: 'CREATE_TRADE_REQUEST', request: proposal }),
    );
    expect(response.status).toBe(201);
    expect(access.requireMember).toHaveBeenCalledWith(G, U);
    expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, P1);
    expect(banking.createTradeRequest).toHaveBeenCalledWith(G, proposal);
    expect(sentTo(sockets[0] as Socket)).toEqual([
      { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 },
    ]);
  });

  it.each([
    ['ACCEPT_TRADE_REQUEST', 'acceptTradeRequest', P2],
    ['DECLINE_TRADE_REQUEST', 'declineTradeRequest', P2],
    ['CANCEL_TRADE_REQUEST', 'cancelTradeRequest', P1],
  ] as const)(
    '%s needs the counterparty, or the proposer for a withdrawal',
    async (type, method, controlled) => {
      const { session, access, banking } = setup();
      banking.getTradeRequest.mockResolvedValue(stored);
      banking[method]?.mockResolvedValue({ tradeRequest: stored, players: [] });
      const response = await session.mutate(G, U, post({ type, tradeRequestId: R }));
      expect(response.status).toBe(200);
      expect(banking.getTradeRequest).toHaveBeenCalledWith(G, R);
      expect(access.requirePlayerController).toHaveBeenCalledWith(G, U, controlled);
      expect(banking[method]).toHaveBeenCalledWith(G, R);
    },
  );

  it.each(['ACCEPT_TRADE_REQUEST', 'DECLINE_TRADE_REQUEST', 'CANCEL_TRADE_REQUEST'] as const)(
    '%s for a trade that does not exist is a validation error',
    async (type) => {
      const { session, banking } = setup();
      banking.getTradeRequest.mockResolvedValue(null);
      const response = await session.mutate(G, U, post({ type, tradeRequestId: R }));
      expect(response.status).toBe(400);
      expect((await json(response)).error.message).toBe('Trade request not found.');
    },
  );

  it('versions each accepted command one after the other', async () => {
    const { session, sockets } = setup();
    await session.mutate(G, U, post({ type: 'START_GAME' }));
    const second = new Request('https://game-session/mutation', {
      method: 'POST',
      body: JSON.stringify({ commandId: CMD2, type: 'START_GAME' }),
    });
    await session.mutate(G, U, second);
    expect(sentTo(sockets[0] as Socket).map((event) => event.stateVersion)).toEqual([1, 2]);
  });
});
