import './test-support/auto-response-stub.js';
import { describe, expect, it } from 'vitest';
import { buildTransaction, testUuid } from '../shared/test-support/fixtures.js';
import { mutationRequest } from '../shared/test-support/requests.js';
import { GameSession } from './game-session.js';
import { createSessionHarness, type SessionInternals } from './test-support/session-harness.js';

const gameId = testUuid(1);
const commandId = testUuid(2);
const walletId = testUuid(3);

const createTransactionCommand = (request: Record<string, unknown>) => ({
  type: 'CREATE_TRANSACTION',
  commandId,
  request,
});
const payToBankCommand = () =>
  createTransactionCommand({ type: 'PLAYER_TO_BANK', playerId: walletId, amount: 100 });
const payToBankResult = () => ({
  transaction: buildTransaction({ id: commandId, gameId }),
  players: [],
});

describe('GameSession live coordinator', () => {
  it('broadcasts one authoritative update to every client and replays duplicate command IDs', async () => {
    const { session, sockets } = createSessionHarness({ sockets: 2 });
    let calls = 0;
    session.banking = () => ({
      createTransaction: async () => {
        calls += 1;
        return payToBankResult();
      },
    });
    const request = () => mutationRequest(payToBankCommand());

    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect(calls).toBe(1);
    expect(sockets[0]).toHaveLength(1);
    expect(sockets[0]).toEqual(sockets[1]);
    expect(JSON.parse(sockets[0][0])).toMatchObject({
      type: 'GAME_COMMITTED',
      stateVersion: 1,
      transaction: { id: commandId },
      players: [],
    });
  });

  it('rejects requests that did not come through the authenticated Worker gateway', async () => {
    const session = new GameSession(
      { setWebSocketAutoResponse: () => undefined } as never,
      {} as Env,
    );
    expect((await session.fetch(new Request('https://game-session/mutation'))).status).toBe(403);
  });

  it('serializes duplicate payment-request accept commands into one settlement', async () => {
    const { session } = createSessionHarness();
    let settlements = 0;
    session.banking = () => ({
      acceptPaymentRequest: async () => {
        settlements += 1;
        return {
          paymentRequest: { id: walletId, state: 'ACCEPTED' },
          transaction: buildTransaction({ id: commandId, gameId, type: 'PLAYER_TO_PLAYER' }),
          players: [],
        };
      },
    });
    const request = () =>
      mutationRequest({
        type: 'ACCEPT_PAYMENT_REQUEST',
        commandId,
        paymentRequestId: walletId,
      });
    await Promise.all([
      session.mutate(gameId, 'actor', request()),
      session.mutate(gameId, 'actor', request()),
    ]);
    expect(settlements).toBe(1);
  });

  it('recovers after completion failure: 20 parallel retries leave one transaction and one balance delta', async () => {
    const { session } = createSessionHarness({ failCompleteOnce: true });
    let transactionCount = 0;
    let balanceDelta = 0;
    let persisted = false;
    session.banking = () => ({
      createTransaction: async () => {
        if (!persisted) {
          persisted = true;
          transactionCount += 1;
          balanceDelta -= 100;
        }
        return payToBankResult();
      },
    });
    const request = () => mutationRequest(payToBankCommand());
    const firstWave = await Promise.all(
      Array.from({ length: 20 }, () => session.mutate(gameId, 'actor', request())),
    );
    expect(firstWave.every((response) => response.status === 500 || response.status === 201)).toBe(
      true,
    );
    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect(transactionCount).toBe(1);
    expect(balanceDelta).toBe(-100);
  });

  it('does not duplicate a committed transaction when every post-commit await is fault-injected', async () => {
    for (const stage of [
      'executed',
      'ledger-completed',
      'version-incremented',
      'published',
    ] as const) {
      const { session } = createSessionHarness();
      let transactionCount = 0;
      let delta = 0;
      let persisted = false;
      let fail = true;
      session.banking = () => ({
        createTransaction: async () => {
          if (!persisted) {
            persisted = true;
            transactionCount += 1;
            delta -= 100;
          }
          return payToBankResult();
        },
      });
      session.afterCommit = async (current) => {
        if (current === stage && fail) {
          fail = false;
          throw new Error(`Injected ${stage}`);
        }
      };
      const request = () => mutationRequest(payToBankCommand());
      expect((await session.mutate(gameId, 'actor', request())).status).toBe(500);
      expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
      expect({ transactionCount, delta }).toEqual({ transactionCount: 1, delta: -100 });
    }
  });

  it('isolates a broken socket while delivering the committed event to healthy clients', async () => {
    const delivered: string[] = [];
    let closed = false;
    const context = {
      storage: { get: async <T>() => undefined as T | undefined, put: async () => undefined },
      setWebSocketAutoResponse: () => undefined,
      getWebSockets: () => [
        {
          send: () => {
            throw new Error('broken');
          },
          close: () => {
            closed = true;
          },
        },
        { send: (message: string) => delivered.push(message), close: () => undefined },
      ],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      broadcast(event: unknown): Promise<void>;
    };
    await session.broadcast({ type: 'HEARTBEAT', stateVersion: 2 });
    expect(closed).toBe(true);
    expect(delivered).toEqual([JSON.stringify({ type: 'HEARTBEAT', stateVersion: 2 })]);
  });

  it('counts multiple hibernatable sockets for one actor as one presence', () => {
    const context = {
      setWebSocketAutoResponse: () => undefined,
      getWebSockets: () => [
        { deserializeAttachment: () => ({ userId: 'actor-a' }) },
        { deserializeAttachment: () => ({ userId: 'actor-a' }) },
        { deserializeAttachment: () => ({ userId: 'actor-b' }) },
      ],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      connectedActors(): number;
    };
    expect(session.connectedActors()).toBe(2);
  });
});

describe('GameSession reversal authorization', () => {
  const transactionId = testUuid(0xbb);
  const stored = buildTransaction({
    id: transactionId,
    gameId,
    createdAt: '2026-01-01 10:00:00',
    participants: [{ playerId: walletId, balanceDelta: -100 }],
  });
  const command = createTransactionCommand({ type: 'REVERSAL', transactionId });

  function sessionWith(found: typeof stored | null) {
    const session = new GameSession(
      { setWebSocketAutoResponse: () => undefined } as never,
      {} as Env,
    ) as unknown as SessionInternals;
    const calls = { authorities: [] as unknown[], walletChecks: 0 };
    session.access = () => ({
      requireMember: async () => 'PLAYER',
      requirePlayerController: async () => {
        calls.walletChecks += 1;
      },
      requireReversalAuthority: async (_gameId: string, _userId: string, transaction: unknown) => {
        calls.authorities.push(transaction);
      },
    });
    session.banking = () => ({ getTransaction: async () => found });
    return { session, calls };
  }

  it('checks the stored transaction instead of a wallet named in the command', async () => {
    const { session, calls } = sessionWith(stored);
    await session.authorizeMutation(gameId, 'actor', command);
    expect(calls.authorities).toEqual([stored]);
    expect(calls.walletChecks).toBe(0);
  });

  it('refuses a reversal of a transaction that does not exist', async () => {
    const { session, calls } = sessionWith(null);
    await expect(session.authorizeMutation(gameId, 'actor', command)).rejects.toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
    });
    expect(calls.authorities).toEqual([]);
  });
});

describe('GameSession mortgage events', () => {
  it('sends the active mortgages with the committed transaction', async () => {
    const { session, messages } = createSessionHarness({ sockets: 1 });
    const mortgages = [{ id: 'm1', propertyName: 'Boardwalk' }];
    session.banking = () => ({
      createTransaction: async () => ({
        transaction: buildTransaction({
          id: commandId,
          gameId,
          type: 'MORTGAGE',
          comment: 'Boardwalk',
        }),
        players: [],
        mortgages,
      }),
    });

    await session.mutate(
      gameId,
      'actor',
      mutationRequest(
        createTransactionCommand({
          type: 'MORTGAGE',
          playerId: walletId,
          propertyName: 'Boardwalk',
          amount: 100,
        }),
      ),
    );

    expect(JSON.parse(messages[0] ?? '{}')).toMatchObject({ type: 'GAME_COMMITTED', mortgages });
  });
});

describe('GameSession bank loan events', () => {
  it('sends the loans and cooldowns with every committed transaction', async () => {
    const { session, messages } = createSessionHarness({ sockets: 1 });
    const loans = [{ id: 'l1', lenderKind: 'BANK', rounds: { round: 2 } }];
    const bankLoanCooldowns = [{ playerId: 'p1', roundsLeft: 1 }];
    session.banking = () => ({
      createTransaction: async () => ({
        transaction: buildTransaction({
          id: commandId,
          gameId,
          type: 'PASS_GO',
          amount: 200,
          totalAmount: 200,
        }),
        players: [],
        loans,
        bankLoanCooldowns,
      }),
    });

    await session.mutate(
      gameId,
      'actor',
      mutationRequest(createTransactionCommand({ type: 'PASS_GO', playerId: walletId })),
    );

    expect(JSON.parse(messages[0] ?? '{}')).toMatchObject({
      type: 'GAME_COMMITTED',
      loans,
      bankLoanCooldowns,
    });
  });
});

describe('GameSession jackpot events', () => {
  it('sends the pot with a committed transaction, and omits it without the rule', async () => {
    const run = async (jackpot: number | undefined) => {
      const { session, messages } = createSessionHarness({ sockets: 1 });
      session.banking = () => ({
        createTransaction: async () => ({
          transaction: buildTransaction({
            id: commandId,
            gameId,
            type: 'JACKPOT_PAYOUT',
            amount: 275,
            totalAmount: 275,
          }),
          players: [],
          ...(jackpot === undefined ? {} : { jackpot }),
        }),
      });
      await session.mutate(
        gameId,
        'actor',
        mutationRequest(
          createTransactionCommand({
            type: 'JACKPOT_PAYOUT',
            playerId: walletId,
            expectedAmount: 275,
          }),
        ),
      );
      return JSON.parse(messages[0] ?? '{}') as Record<string, unknown>;
    };

    expect(await run(0)).toMatchObject({ type: 'GAME_COMMITTED', jackpot: 0 });
    expect(await run(undefined)).not.toHaveProperty('jackpot');
  });
});

describe('GameSession trade requests', () => {
  const tradeRequestId = testUuid(0xd1);
  const proposer = testUuid(0xd2);
  const counterparty = testUuid(0xd3);
  const stored = {
    id: tradeRequestId,
    proposerPlayerId: proposer,
    counterpartyPlayerId: counterparty,
  };

  function build() {
    const { session, messages } = createSessionHarness({ sockets: 1, authorizeAll: false });
    const controlled: string[] = [];
    session.access = () => ({
      requireMember: async () => 'PLAYER',
      requirePlayerController: async (_gameId: string, _userId: string, playerId: string) => {
        controlled.push(playerId);
      },
    });
    return { session, sent: messages, controlled };
  }
  const send = (session: SessionInternals, command: Record<string, unknown>) =>
    session.mutate(gameId, 'actor', mutationRequest({ commandId, ...command }));
  const accepted = {
    tradeRequest: { ...stored, state: 'ACCEPTED' },
    transaction: buildTransaction({
      id: commandId,
      gameId,
      type: 'PROPERTY_TRANSFER',
      amount: 0,
      totalAmount: 0,
    }),
    players: [],
  };

  it('authorizes the proposer to create and cancel, the counterparty to accept and decline', async () => {
    const { session, controlled } = build();
    session.banking = () => ({ getTradeRequest: async () => stored });
    await session.authorizeMutation(gameId, 'actor', {
      type: 'CREATE_TRADE_REQUEST',
      commandId,
      request: { id: tradeRequestId, playerId: proposer },
    });
    await session.authorizeMutation(gameId, 'actor', {
      type: 'CANCEL_TRADE_REQUEST',
      commandId,
      tradeRequestId,
    });
    await session.authorizeMutation(gameId, 'actor', {
      type: 'ACCEPT_TRADE_REQUEST',
      commandId,
      tradeRequestId,
    });
    await session.authorizeMutation(gameId, 'actor', {
      type: 'DECLINE_TRADE_REQUEST',
      commandId,
      tradeRequestId,
    });
    expect(controlled).toEqual([proposer, proposer, counterparty, counterparty]);
  });

  it('refuses a command for a trade request that does not exist', async () => {
    const { session } = build();
    session.banking = () => ({ getTradeRequest: async () => null });
    await expect(
      session.authorizeMutation(gameId, 'actor', {
        type: 'ACCEPT_TRADE_REQUEST',
        commandId,
        tradeRequestId,
      }),
    ).rejects.toBeDefined();
  });

  it('settles a repeated accept command once and announces the commit and the pending update', async () => {
    const { session, sent } = build();
    let settlements = 0;
    session.banking = () => ({
      getTradeRequest: async () => stored,
      acceptTradeRequest: async () => {
        settlements += 1;
        return accepted;
      },
    });
    const command = { type: 'ACCEPT_TRADE_REQUEST', tradeRequestId };
    await Promise.all([send(session, command), send(session, command)]);
    await send(session, command);
    expect(settlements).toBe(1);
    const types = sent.map((message) => (JSON.parse(message) as { type: string }).type);
    expect(types).toEqual(['GAME_COMMITTED', 'TRADE_REQUESTS_UPDATED']);
  });

  it('announces a created, declined or cancelled request as a pending-requests update', async () => {
    const { session, sent } = build();
    const response = { tradeRequest: stored, players: [] };
    session.banking = () => ({
      getTradeRequest: async () => stored,
      createTradeRequest: async () => response,
      declineTradeRequest: async () => response,
      cancelTradeRequest: async () => response,
    });
    const ids = [1, 2, 3].map(testUuid);
    const commands: Array<Record<string, unknown>> = [
      { type: 'CREATE_TRADE_REQUEST', request: { id: tradeRequestId, playerId: proposer } },
      { type: 'DECLINE_TRADE_REQUEST', tradeRequestId },
      { type: 'CANCEL_TRADE_REQUEST', tradeRequestId },
    ];
    for (const [index, command] of commands.entries())
      await send(session, { ...command, commandId: ids[index] });
    expect(sent.map((message) => (JSON.parse(message) as { type: string }).type)).toEqual([
      'TRADE_REQUESTS_UPDATED',
      'TRADE_REQUESTS_UPDATED',
      'TRADE_REQUESTS_UPDATED',
    ]);
  });
});
