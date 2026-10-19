import './auto-response-stub.js';
import { vi, type Mock } from 'vitest';
import { GameSession } from '../game-session.js';

export const G = '00000000-0000-4000-8000-000000000001';
export const U = 'user-1';
export const P1 = '00000000-0000-4000-8000-0000000000a1';
export const P2 = '00000000-0000-4000-8000-0000000000a2';
export const CMD = '00000000-0000-4000-8000-0000000000c1';
export const CMD2 = '00000000-0000-4000-8000-0000000000c2';
export const AUCTION = '00000000-0000-4000-8000-0000000000d1';
export const START = Date.parse('2026-01-01T00:00:00.000Z');

export type Fn = Mock<(...args: unknown[]) => unknown>;

export interface FakeSocket {
  send: Fn;
  close: Fn;
  serializeAttachment: Fn;
  deserializeAttachment(): unknown;
}

export interface Seams {
  mutate(gameId: string, userId: string, request: Request): Promise<Response>;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
  access(): unknown;
  banking(commandId: string): unknown;
  gameService(): unknown;
  auctions(): unknown;
  commandLedger(): unknown;
  transactions(): unknown;
  finishGame(gameId: string, winners: string[]): Promise<unknown>;
  authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
}

export const fns = (...names: string[]): Record<string, Fn> =>
  Object.fromEntries(names.map((name) => [name, vi.fn(() => Promise.resolve(undefined))]));

export const socket = (attachment: unknown = { userId: U }): FakeSocket => ({
  send: vi.fn(),
  close: vi.fn(),
  serializeAttachment: vi.fn(),
  deserializeAttachment: () => attachment,
});

export const sentTo = (ws: { send: Fn }): Array<Record<string, unknown>> =>
  ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);

export const gameDetails = (status = 'LOBBY', extra: Record<string, unknown> = {}) => ({
  game: { id: G, status, rules: { bankLoans: false } },
  players: [{ id: P1 }, { id: P2 }],
  ...extra,
});

export interface Ledger {
  claim: Fn;
  complete: Fn;
}

export function harness(
  options: { sockets?: FakeSocket[]; stored?: Record<string, unknown> } = {},
) {
  const sockets = options.sockets ?? [socket()];
  const storage = new Map<string, unknown>(Object.entries(options.stored ?? {}));
  let alarm: number | null = null;
  const context = {
    storage: {
      get: <T>(key: string) => Promise.resolve(storage.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        storage.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => Promise.resolve(storage.delete(key)),
      setAlarm: (time: number) => {
        alarm = time;
        return Promise.resolve();
      },
      deleteAlarm: () => {
        alarm = null;
        return Promise.resolve();
      },
    },
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: vi.fn(),
    acceptWebSocket: vi.fn((ws: FakeSocket) => {
      sockets.push(ws);
    }),
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
  access.controlledWallets = vi.fn(() => Promise.resolve([]));
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
  gameService.getGame = vi.fn(() => Promise.resolve(gameDetails()));
  gameService.startGame = vi.fn(() => Promise.resolve(gameDetails('ACTIVE')));
  const auctions = fns('startAuction', 'placeBid', 'getCurrent', 'settleDue');
  auctions.getCurrent = vi.fn(() => Promise.resolve(null));
  const transactions = { listByGameId: vi.fn(() => Promise.resolve([])) };
  const claimed = new Map<string, 'PENDING' | 'COMPLETED'>();
  const results = new Map<string, { status: number | null; json: string | null }>();
  const ledger: Ledger = {
    claim: vi.fn((...args: unknown[]) => {
      const input = args[0] as { commandId: string };
      const stored = results.get(input.commandId);
      return Promise.resolve({
        ...input,
        status: claimed.get(input.commandId) ?? 'PENDING',
        resultStatus: stored === undefined ? 200 : stored.status,
        resultJson: stored === undefined ? JSON.stringify({ replayed: true }) : stored.json,
      });
    }),
    complete: vi.fn((...args: unknown[]) => {
      const input = args[0] as { commandId: string; status: number; result: unknown };
      claimed.set(input.commandId, 'COMPLETED');
      results.set(input.commandId, { status: input.status, json: JSON.stringify(input.result) });
      return Promise.resolve();
    }),
  };
  session.access = () => access;
  session.banking = () => banking;
  session.gameService = () => gameService;
  session.auctions = () => auctions;
  session.commandLedger = () => ledger;
  session.transactions = () => transactions;
  const finishGame = vi.fn(() => Promise.resolve(gameDetails('FINISHED')));
  session.finishGame = finishGame;
  return {
    session,
    sockets,
    storage,
    context,
    alarm: () => alarm,
    access,
    banking,
    gameService,
    auctions,
    transactions,
    ledger,
    claimed,
    results,
    finishGame,
  };
}

export const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request('https://game-session/mutation', {
    method: 'POST',
    headers,
    body: JSON.stringify({ commandId: CMD, ...body }),
  });

export interface Body {
  data?: unknown;
  error: { code: string; message: string; requestId?: string };
}
export const json = async (response: Response) => (await response.json()) as Body;
