import { describe, expect, it } from 'vitest';
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
