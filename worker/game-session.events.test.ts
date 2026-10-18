import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUCTION,
  CMD,
  CMD2,
  G,
  P1,
  START,
  U,
  gameDetails,
  harness,
  json,
  post,
  sentTo,
  socket,
} from './test-support/game-session-harness.js';

const tx = { id: 'tx-1', type: 'PLAYER_TO_BANK' };
const payRequest = {
  type: 'CREATE_TRANSACTION',
  request: { type: 'PLAYER_TO_BANK', playerId: P1, amount: 10 },
};

function watched() {
  const observer = socket({ userId: 'other' });
  const setup = harness({ sockets: [observer] });
  return { ...setup, observer, events: () => sentTo(observer) };
}

describe('events published after a command', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it('tells the table about a joined player with the lobby only', async () => {
    const { session, events } = watched();
    const response = await session.mutate(
      G,
      U,
      post({
        type: 'JOIN_LOBBY',
        playerId: P1,
        nickname: 'Ann',
        color: '#fff',
        startingBalance: 1500,
      }),
    );
    expect(response.status).toBe(201);
    expect(events()).toEqual([
      {
        type: 'LOBBY_UPDATED',
        stateVersion: 1,
        details: { game: gameDetails().game, players: gameDetails().players },
      },
    ]);
  });

  it('tells the table about a removed player the same way', async () => {
    const { session, events, access } = watched();
    await session.mutate(G, U, post({ type: 'REMOVE_PLAYER', playerId: P1 }));
    expect(access.removeLobbyPlayer).toHaveBeenCalledWith(G, U, P1);
    expect(events().map((event) => event.type)).toEqual(['LOBBY_UPDATED']);
  });

  it('announces a started game as a lobby update and a finished one as the final details', async () => {
    const { session, events, finishGame } = watched();
    await session.mutate(G, U, post({ type: 'START_GAME' }));
    await session.mutate(
      G,
      U,
      post({ type: 'FINISH_GAME', winnerPlayerIds: [P1], commandId: CMD2 }),
    );
    expect(finishGame).toHaveBeenCalledWith(G, [P1]);
    expect(events()).toEqual([
      expect.objectContaining({ type: 'LOBBY_UPDATED', stateVersion: 1 }),
      { type: 'GAME_FINISHED', stateVersion: 2, details: gameDetails('FINISHED') },
    ]);
  });

  it('announces a started auction and a bid as auction updates', async () => {
    const { session, events, auctions } = watched();
    const running = {
      id: AUCTION,
      state: 'ACTIVE',
      endsAt: new Date(START + 30_000).toISOString(),
    };
    auctions.startAuction.mockResolvedValue({ auction: running });
    auctions.placeBid.mockResolvedValue({ auction: { ...running, version: 2 } });
    await session.mutate(
      G,
      U,
      post({ type: 'START_AUCTION', request: { initiatorPlayerId: P1, lotName: 'Lot' } }),
    );
    await session.mutate(
      G,
      U,
      post({
        type: 'PLACE_BID',
        commandId: CMD2,
        request: { bidderPlayerId: P1, auctionId: AUCTION, expectedVersion: 1, step: 10 },
      }),
    );
    expect(events()).toEqual([
      { type: 'AUCTION_UPDATED', stateVersion: 1, auction: running },
      { type: 'AUCTION_UPDATED', stateVersion: 2, auction: { ...running, version: 2 } },
    ]);
  });

  it('does not arm the alarm for a bid that closes the auction or leaves no auction', async () => {
    const { session, auctions, storage, alarm } = watched();
    const request = {
      type: 'PLACE_BID',
      request: { bidderPlayerId: P1, auctionId: AUCTION, expectedVersion: 1, step: 10 },
    };
    auctions.placeBid.mockResolvedValue({ auction: { id: AUCTION, state: 'SOLD', endsAt: 'x' } });
    expect((await session.mutate(G, U, post(request))).status).toBe(200);
    auctions.placeBid.mockResolvedValue({ auction: null });
    expect((await session.mutate(G, U, post({ ...request, commandId: CMD2 }))).status).toBe(200);
    expect(storage.has('auctionDeadline')).toBe(false);
    expect(alarm()).toBeNull();
  });

  it('moves the alarm to the new end when a late bid extends a running auction', async () => {
    const { session, auctions, storage, alarm } = watched();
    const later = new Date(START + 40_000).toISOString();
    auctions.placeBid.mockResolvedValue({
      auction: { id: AUCTION, state: 'ACTIVE', endsAt: later },
    });
    await session.mutate(
      G,
      U,
      post({
        type: 'PLACE_BID',
        request: { bidderPlayerId: P1, auctionId: AUCTION, expectedVersion: 1, step: 10 },
      }),
    );
    expect(alarm()).toBe(START + 40_000);
    expect(storage.get('auctionDeadline')).toEqual({
      gameId: G,
      auctionId: AUCTION,
      endsAt: START + 40_000,
    });
  });

  it('does not arm the alarm when starting an auction returned no running one', async () => {
    const { session, auctions, alarm } = watched();
    auctions.startAuction.mockResolvedValue({ auction: null });
    const response = await session.mutate(
      G,
      U,
      post({ type: 'START_AUCTION', request: { initiatorPlayerId: P1, lotName: 'Lot' } }),
    );
    expect(response.status).toBe(201);
    expect(alarm()).toBeNull();
  });

  it('announces a payment request created through a transaction as a pending-requests update only', async () => {
    const { session, events, banking } = watched();
    banking.createTransaction.mockResolvedValue({ paymentRequests: [{ id: 'r1' }], players: [] });
    await session.mutate(G, U, post(payRequest));
    expect(events()).toEqual([{ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 }]);
  });

  it('announces an executed transaction as a commit only', async () => {
    const { session, events, banking } = watched();
    banking.createTransaction.mockResolvedValue({ transaction: tx, players: [{ id: P1 }] });
    await session.mutate(G, U, post(payRequest));
    expect(events()).toEqual([
      { type: 'GAME_COMMITTED', stateVersion: 1, transaction: tx, players: [{ id: P1 }] },
    ]);
  });

  it('carries every optional part of the committed state, each only when present', async () => {
    const full = watched();
    const extras = {
      mortgages: [{ id: 'm' }],
      loans: [{ id: 'l' }],
      bankLoanCooldowns: [{ playerId: P1 }],
      jackpot: 0,
      properties: [{ tileId: 't' }],
    };
    full.banking.createTransaction.mockResolvedValue({ transaction: tx, players: [], ...extras });
    await full.session.mutate(G, U, post(payRequest));
    expect(full.events()).toEqual([
      { type: 'GAME_COMMITTED', stateVersion: 1, transaction: tx, players: [], ...extras },
    ]);
    for (const key of Object.keys(extras)) {
      const partial = watched();
      const { [key as keyof typeof extras]: omitted, ...rest } = extras;
      void omitted;
      partial.banking.createTransaction.mockResolvedValue({
        transaction: tx,
        players: [],
        ...rest,
      });
      await partial.session.mutate(G, U, post(payRequest));
      expect(partial.events()[0]).not.toHaveProperty(key);
      expect(partial.events()[0]).toMatchObject(rest);
    }
  });

  it('does not report a commit for an answered payment request that moved no money', async () => {
    const { session, events, banking } = watched();
    banking.declinePaymentRequest.mockResolvedValue({ paymentRequest: { state: 'DECLINED' } });
    banking.getPaymentRequest.mockResolvedValue({ approverPlayerId: P1, creatorPlayerId: P1 });
    await session.mutate(G, U, post({ type: 'DECLINE_PAYMENT_REQUEST', paymentRequestId: 'r' }));
    expect(events()).toEqual([{ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 }]);
  });

  it('reports the commit before the pending-requests update for an accepted request', async () => {
    const { session, events, banking } = watched();
    banking.getPaymentRequest.mockResolvedValue({ approverPlayerId: P1, creatorPlayerId: P1 });
    banking.acceptPaymentRequest.mockResolvedValue({ transaction: tx, players: [] });
    await session.mutate(G, U, post({ type: 'ACCEPT_PAYMENT_REQUEST', paymentRequestId: 'r' }));
    expect(events().map((event) => event.type)).toEqual([
      'GAME_COMMITTED',
      'PAYMENT_REQUESTS_UPDATED',
    ]);
  });

  it('does not touch the auction when a command other than a bankruptcy runs during one', async () => {
    const stored = { gameId: G, auctionId: AUCTION, endsAt: START + 600_000 };
    const observer = socket({ userId: 'other' });
    const { session, banking } = harness({
      sockets: [observer],
      stored: { auctionDeadline: stored },
    });
    banking.getPaymentRequest.mockResolvedValue({ approverPlayerId: P1, creatorPlayerId: P1 });
    banking.cancelPaymentRequest.mockResolvedValue({ paymentRequest: { state: 'CANCELLED' } });
    await session.mutate(G, U, post({ type: 'CANCEL_PAYMENT_REQUEST', paymentRequestId: 'r' }));
    expect(sentTo(observer).map((event) => event.type)).toEqual(['PAYMENT_REQUESTS_UPDATED']);
  });

  it('announces a bankruptcy with the bankrupt player, the pending update and the changed auction', async () => {
    const stored = { gameId: G, auctionId: AUCTION, endsAt: START + 600_000 };
    const observer = socket({ userId: 'other' });
    const { session, banking, auctions } = harness({
      sockets: [observer],
      stored: { auctionDeadline: stored },
    });
    banking.declareBankruptcy.mockResolvedValue({ transaction: tx, players: [] });
    auctions.getCurrent.mockResolvedValue({ id: AUCTION, state: 'ACTIVE', leader: null });
    const response = await session.mutate(
      G,
      U,
      post({ type: 'DECLARE_BANKRUPTCY', request: { playerId: P1, creditor: { kind: 'BANK' } } }),
    );
    expect(response.status).toBe(201);
    expect(auctions.getCurrent).toHaveBeenCalledWith(G);
    expect(sentTo(observer)).toEqual([
      {
        type: 'GAME_COMMITTED',
        stateVersion: 1,
        transaction: tx,
        players: [],
        bankruptPlayerId: P1,
      },
      { type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 },
      {
        type: 'AUCTION_UPDATED',
        stateVersion: 1,
        auction: { id: AUCTION, state: 'ACTIVE', leader: null },
      },
    ]);
  });

  it('announces a bankruptcy without an auction as a commit and the pending update', async () => {
    const { session, banking, events } = watched();
    banking.declareBankruptcy.mockResolvedValue({ transaction: tx, players: [] });
    await session.mutate(
      G,
      U,
      post({ type: 'DECLARE_BANKRUPTCY', request: { playerId: P1, creditor: { kind: 'BANK' } } }),
    );
    expect(events().map((event) => event.type)).toEqual([
      'GAME_COMMITTED',
      'PAYMENT_REQUESTS_UPDATED',
    ]);
  });
});

describe('the command ledger', () => {
  it('records the transaction id of the result, and none when the result has no usable one', async () => {
    const cases: Array<[unknown, string | null]> = [
      [{ transaction: { id: 'tx-9' }, players: [] }, 'tx-9'],
      [{ transaction: { id: 9 }, players: [] }, null],
      [{ transaction: null, players: [] }, null],
      [{ players: [] }, null],
    ];
    for (const [data, expected] of cases) {
      const { session, banking, ledger } = watched();
      banking.createTransaction.mockResolvedValue(data);
      await session.mutate(G, U, post(payRequest));
      expect(ledger.complete).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: expected, status: 201, result: data }),
      );
    }
  });

  it('records no transaction for a result that is not an object', async () => {
    const { session, gameService, ledger } = watched();
    gameService.startGame.mockResolvedValue('started');
    const response = await session.mutate(G, U, post({ type: 'START_GAME' }));
    expect(response.status).toBe(200);
    expect(ledger.complete).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null }));
  });

  const claimedHash = async (body: Record<string, unknown>) => {
    const { session, ledger } = watched();
    await session.mutate(G, U, post(body));
    const input = ledger.claim.mock.calls[0]?.[0] as { payloadHash: string };
    return input.payloadHash;
  };

  it('identifies a payload by a SHA-256 digest that ignores the command id and key order', async () => {
    const a = await claimedHash({
      type: 'CREATE_TRANSACTION',
      request: { x: 1, y: { p: 1, q: 2 } },
    });
    const b = await claimedHash({
      request: { y: { q: 2, p: 1 }, x: 1 },
      type: 'CREATE_TRANSACTION',
      commandId: CMD2,
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(b).toBe(a);
  });

  it('tells payloads apart by their values, array contents and nesting', async () => {
    const hashes = await Promise.all(
      [
        { x: 1 },
        { x: 2 },
        { x: [1, 23] },
        { x: [12, 3] },
        { x: [1, 2, 3] },
        { x: [3, 2, 1] },
        { x: { y: 1 } },
        { x: { y: 2 } },
        { x: null },
        { x: 'a' },
      ].map((request) => claimedHash({ type: 'CREATE_TRANSACTION', request })),
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('refuses a completed command whose stored result is incomplete instead of replaying it', async () => {
    for (const stored of [
      { status: null, json: '{}' },
      { status: 200, json: null },
    ]) {
      const { session, claimed, results, banking } = watched();
      claimed.set(CMD, 'COMPLETED');
      results.set(CMD, stored);
      const response = await session.mutate(G, U, post(payRequest));
      expect(response.status).toBe(400);
      expect((await json(response)).error.message).toBe('Completed command has no result.');
      expect(banking.createTransaction).not.toHaveBeenCalled();
    }
  });

  it('replays a completed command with its original status and result, publishing nothing', async () => {
    const { session, claimed, results, banking, events } = watched();
    claimed.set(CMD, 'COMPLETED');
    results.set(CMD, { status: 201, json: JSON.stringify({ transaction: tx, players: [] }) });
    const response = await session.mutate(G, U, post(payRequest));
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({ data: { transaction: tx, players: [] } });
    expect(banking.createTransaction).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });
});

describe('command errors', () => {
  it('names the invalid live command in the 400 and logs the mutation path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { session } = watched();
      const response = await session.mutate(
        G,
        U,
        new Request('https://game-session/mutation', {
          method: 'POST',
          headers: { 'x-request-id': 'req-bad' },
          body: '{"type":"NOPE"}',
        }),
      );
      expect(response.status).toBe(400);
      expect((await json(response)).error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid live mutation command.',
        requestId: 'req-bad',
      });
      const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(logged).toMatchObject({
        path: '/mutation',
        method: 'POST',
        gameId: G,
        userId: U,
        requestId: 'req-bad',
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('answers a command with the request id it came with', async () => {
    const { session } = watched();
    const response = await session.mutate(
      G,
      U,
      post({ type: 'START_GAME' }, { 'x-request-id': 'r-7' }),
    );
    expect(response.headers.get('x-request-id')).toBe('r-7');
  });

  it('generates a request id for a failed command that had none', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { session, gameService } = watched();
      gameService.startGame.mockRejectedValue(new Error('boom'));
      const response = await session.mutate(G, U, post({ type: 'START_GAME' }));
      expect(response.status).toBe(500);
      const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as { requestId: string };
      expect(logged.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect((await json(response)).error.requestId).toBe(logged.requestId);
    } finally {
      error.mockRestore();
    }
  });

  it('routes the mutation path to commands and nothing else', async () => {
    const { session, gameService } = watched();
    const response = await session.fetch(
      new Request('https://game-session/mutation', {
        method: 'POST',
        headers: { 'x-game-id': G, 'x-user-id': U },
        body: JSON.stringify({ commandId: CMD, type: 'START_GAME' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(gameService.startGame).toHaveBeenCalledWith(G);
    const other = await session.fetch(
      new Request('https://game-session/mutations', {
        method: 'POST',
        headers: { 'x-game-id': G, 'x-user-id': U },
      }),
    );
    expect(other.status).toBe(404);
  });
});

describe('authorization before a command runs', () => {
  it('refuses to join a lobby that is no longer open, before seating anyone', async () => {
    const { session, gameService, access } = harness();
    gameService.getGame.mockResolvedValue(gameDetails('ACTIVE'));
    const response = await session.mutate(
      G,
      U,
      post({
        type: 'JOIN_LOBBY',
        playerId: P1,
        nickname: 'Ann',
        color: '#fff',
        startingBalance: 1500,
      }),
    );
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({
      code: 'LOBBY_CLOSED',
      message: 'This lobby is no longer open for new players.',
    });
    expect(access.joinLobby).not.toHaveBeenCalled();
    expect(access.requireLobbySeat).not.toHaveBeenCalled();
  });

  it('asks for a seat in an open lobby with the current head count', async () => {
    const { session, access } = harness();
    await session.mutate(
      G,
      U,
      post({
        type: 'JOIN_LOBBY',
        playerId: P1,
        nickname: 'Ann',
        color: '#fff',
        startingBalance: 1500,
      }),
    );
    expect(access.requireLobbySeat).toHaveBeenCalledWith(G, U, 2);
  });
});
