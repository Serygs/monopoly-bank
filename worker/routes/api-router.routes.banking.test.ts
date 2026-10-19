import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../services/errors.js';
import {
  G,
  P1,
  P2,
  R,
  T,
  CMD,
  USER,
  harness,
  request,
  read,
  withCommand,
} from '../test-support/api-router-harness.js';

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

  it('reads the state version through the live game for a member only', async () => {
    const { router, m } = harness({ live: true });
    const response = await router(request('GET', `/api/games/${G}/version`));
    expect(await read(response)).toEqual({ data: { stateVersion: 3 } });
    expect(m.access.requireMember).toHaveBeenCalledWith(G, USER.id);
    expect(m.live.readVersion).toHaveBeenCalledWith(G, USER);
    m.live.readVersion.mockClear();
    m.access.requireMember.mockRejectedValue(new ForbiddenError());
    const refused = await router(request('GET', `/api/games/${G}/version`));
    expect(refused.status).toBe(403);
    expect(m.live.readVersion).not.toHaveBeenCalled();
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
