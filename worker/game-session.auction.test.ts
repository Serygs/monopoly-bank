import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from './game-session.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';
const auctionId = '00000000-0000-4000-8000-000000000003';
const START = Date.parse('2026-01-01T00:00:00.000Z');
const endsAt = new Date(START + 30_000).toISOString();

const closed = {
  auction: { id: auctionId, state: 'SOLD', endsAt },
  transaction: { id: 'tx', type: 'AUCTION_PAYMENT' },
  players: [],
};

interface Seams {
  mutate(gameId: string, userId: string, request: Request): Promise<Response>;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
  auctions(): unknown;
  gameService(): unknown;
  commandLedger(): unknown;
  authorizeMutation(): Promise<void>;
  banking(commandId: string): unknown;
}

function harness() {
  const sent: Record<string, unknown>[] = [];
  const storage = new Map<string, unknown>();
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
    getWebSockets: () => [
      { send: (message: string) => sent.push(JSON.parse(message) as Record<string, unknown>) },
    ],
  };
  const session = new GameSession(context as never, {} as Env) as unknown as Seams;
  const claimed = new Map<string, 'PENDING' | 'COMPLETED'>();
  session.commandLedger = () => ({
    claim: async (input: { commandId: string; gameId: string }) => {
      if (!claimed.has(input.commandId)) claimed.set(input.commandId, 'PENDING');
      return { ...input, status: claimed.get(input.commandId) };
    },
    complete: async (input: { commandId: string }) => {
      claimed.set(input.commandId, 'COMPLETED');
    },
  });
  session.authorizeMutation = async () => undefined;
  const settle = vi.fn(async () => closed);
  session.auctions = () => ({
    settleDue: settle,
    startAuction: async () => ({ auction: { id: auctionId, state: 'ACTIVE', endsAt } }),
    getCurrent: async () => closed.auction,
  });
  session.gameService = () => ({
    getGame: async () => ({ game: { rules: { bankLoans: false } }, players: [] }),
  });
  return { session, sent, storage, claimed, settle, alarm: () => alarm };
}

describe('GameSession auction settlement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  const startRequest = () =>
    new Request('https://game-session/mutation', {
      method: 'POST',
      body: JSON.stringify({
        type: 'START_AUCTION',
        commandId,
        request: { initiatorPlayerId: 'p', lotName: 'Lot' },
      }),
    });

  it('arms the alarm when an auction starts and announces it', async () => {
    const { session, sent, storage, alarm } = harness();
    const response = await session.mutate(gameId, 'actor', startRequest());
    expect(response.status).toBe(201);
    expect(alarm()).toBe(START + 30_000);
    expect(storage.get('auctionDeadline')).toEqual({ gameId, auctionId, endsAt: START + 30_000 });
    expect(sent).toEqual([expect.objectContaining({ type: 'AUCTION_UPDATED', stateVersion: 1 })]);
  });

  it('settles from the alarm: one bumped version, AUCTION_UPDATED then GAME_COMMITTED', async () => {
    const { session, sent, storage, claimed, settle, alarm } = harness();
    await session.mutate(gameId, 'actor', startRequest());
    sent.length = 0;
    vi.setSystemTime(START + 30_000);
    await session.alarm();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(sent.map((event) => [event.type, event.stateVersion])).toEqual([
      ['AUCTION_UPDATED', 2],
      ['GAME_COMMITTED', 2],
    ]);
    expect(claimed.get(`auction-settle:${auctionId}`)).toBe('COMPLETED');
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });

  it('settles lazily before a command and never twice', async () => {
    const { session, sent, settle } = harness();
    await session.mutate(gameId, 'actor', startRequest());
    sent.length = 0;
    vi.setSystemTime(START + 31_000);
    session.banking = () => ({
      createTransaction: async () => ({ transaction: { id: commandId }, players: [] }),
    });
    await session.mutate(
      gameId,
      'actor',
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'CREATE_TRANSACTION',
          commandId: '00000000-0000-4000-8000-000000000009',
          request: { type: 'PLAYER_TO_BANK', playerId: 'p', amount: 10 },
        }),
      }),
    );
    await session.alarm(); // the alarm arrives late
    expect(settle).toHaveBeenCalledTimes(1);
    expect(sent.map((event) => [event.type, event.stateVersion])).toEqual([
      ['AUCTION_UPDATED', 2],
      ['GAME_COMMITTED', 2],
      ['GAME_COMMITTED', 3],
    ]);
  });

  it('serves the polling read through the same lazy settlement', async () => {
    const { session, settle } = harness();
    (session as unknown as { access(): unknown }).access = () => ({
      requireMember: async () => 'PLAYER',
    });
    await session.mutate(gameId, 'actor', startRequest());
    vi.setSystemTime(START + 30_000);
    const response = await session.fetch(
      new Request('https://game-session/auction', {
        headers: { 'x-game-id': gameId, 'x-user-id': 'actor' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { auction: { state: 'SOLD' }, transaction: { id: 'tx' } },
    });
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('does nothing before the end and keeps the alarm', async () => {
    const { session, sent, settle, alarm } = harness();
    await session.mutate(gameId, 'actor', startRequest());
    sent.length = 0;
    vi.setSystemTime(START + 10_000);
    await session.alarm();
    expect(settle).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(alarm()).toBe(START + 30_000);
  });

  it('retries by the alarm when settling fails, without losing the deadline', async () => {
    const { session, storage, settle } = harness();
    await session.mutate(gameId, 'actor', startRequest());
    vi.setSystemTime(START + 30_000);
    settle.mockRejectedValueOnce(new Error('D1 unavailable'));
    await expect(session.alarm()).rejects.toThrow('D1 unavailable');
    expect(storage.has('auctionDeadline')).toBe(true);
    await session.alarm();
    expect(storage.has('auctionDeadline')).toBe(false);
  });
});

describe('GameSession serialisation and deadline bookkeeping', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  const command = (id: string, body: Record<string, unknown>) =>
    new Request('https://game-session/mutation', {
      method: 'POST',
      body: JSON.stringify({ commandId: id, ...body }),
    });

  it('never overlaps a debit and a bid, so the reserve check cannot go stale', async () => {
    const { session } = harness();
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.banking = () => ({
      createTransaction: async () => {
        events.push('debit:start');
        await gate;
        events.push('debit:end');
        return { transaction: { id: commandId }, players: [] };
      },
    });
    session.auctions = () => ({
      settleDue: async () => null,
      getCurrent: async () => null,
      placeBid: async () => {
        events.push('bid');
        return { auction: { id: auctionId } };
      },
    });
    const debit = session.mutate(
      gameId,
      'actor',
      command('00000000-0000-4000-8000-000000000010', {
        type: 'CREATE_TRANSACTION',
        request: { type: 'PLAYER_TO_BANK', playerId: 'p', amount: 10 },
      }),
    );
    // The bid is sent only once the debit is running, so the order does not depend on timing.
    await vi.waitFor(() => expect(events).toEqual(['debit:start']));
    const bid = session.mutate(
      gameId,
      'actor',
      command('00000000-0000-4000-8000-000000000011', {
        type: 'PLACE_BID',
        request: { bidderPlayerId: 'p', auctionId, expectedVersion: 1, step: 10 },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['debit:start']);
    release();
    await Promise.all([debit, bid]);
    expect(events).toEqual(['debit:start', 'debit:end', 'bid']);
  });

  it('keeps running commands after one fails, and dedupes by command id', async () => {
    const { session } = harness();
    let calls = 0;
    session.banking = () => ({
      createTransaction: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return { transaction: { id: commandId }, players: [] };
      },
    });
    const request = (id: string) =>
      command(id, {
        type: 'CREATE_TRANSACTION',
        request: { type: 'PLAYER_TO_BANK', playerId: 'p', amount: 10 },
      });
    expect((await session.mutate(gameId, 'a', request(commandId))).status).toBe(500);
    expect(
      (await session.mutate(gameId, 'a', request('00000000-0000-4000-8000-000000000012'))).status,
    ).toBe(201);
  });

  it('does not wipe the deadline of a newer auction when an older one settles', async () => {
    const { session, storage } = harness();
    await session.mutate(
      gameId,
      'actor',
      command(commandId, {
        type: 'START_AUCTION',
        request: { initiatorPlayerId: 'p', lotName: 'Lot' },
      }),
    );
    // The older auction (A) is settling while B has already replaced the stored deadline.
    const newer = { gameId, auctionId: 'newer', endsAt: START + 99_000 };
    const settle = vi.fn(async () => {
      storage.set('auctionDeadline', newer);
      return closed;
    });
    session.auctions = () => ({ settleDue: settle, getCurrent: async () => null });
    vi.setSystemTime(START + 30_000);
    await session.alarm();
    expect(storage.get('auctionDeadline')).toEqual(newer);
  });

  it('arms a running auction found in D1 when storage lost the deadline, and settles it if due', async () => {
    const { session, storage, settle, alarm } = harness();
    session.auctions = () => ({
      settleDue: settle,
      getCurrent: async () => ({ id: auctionId, state: 'ACTIVE', endsAt }),
    });
    vi.setSystemTime(START + 31_000);
    session.banking = () => ({
      createTransaction: async () => ({ transaction: { id: commandId }, players: [] }),
    });
    await session.mutate(
      gameId,
      'actor',
      command(commandId, {
        type: 'CREATE_TRANSACTION',
        request: { type: 'PLAYER_TO_BANK', playerId: 'p', amount: 10 },
      }),
    );
    expect(settle).toHaveBeenCalledTimes(1);
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });
});
