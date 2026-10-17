import { describe, expect, it } from 'vitest';
import { GameSession } from './game-session.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';

describe('GameSession live coordinator', () => {
  it('broadcasts one authoritative update to every client and replays duplicate command IDs', async () => {
    const sent: string[][] = [[], []];
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () =>
        sent.map((messages) => ({ send: (message: string) => messages.push(message) })),
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): { createTransaction(): Promise<unknown> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    let calls = 0;
    session.banking = () => ({
      createTransaction: async () => {
        calls += 1;
        return {
          transaction: {
            id: commandId,
            gameId,
            type: 'PLAYER_TO_BANK',
            amount: 100,
            totalAmount: 100,
            comment: null,
            createdAt: '',
            participants: [],
          },
          players: [],
        };
      },
    });
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    const request = () =>
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'CREATE_TRANSACTION',
          commandId,
          request: {
            type: 'PLAYER_TO_BANK',
            playerId: '00000000-0000-4000-8000-000000000003',
            amount: 100,
          },
        }),
      });

    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect(calls).toBe(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]).toEqual(sent[1]);
    expect(JSON.parse(sent[0][0])).toMatchObject({
      type: 'GAME_COMMITTED',
      stateVersion: 1,
      transaction: { id: commandId },
      players: [],
    });
  });

  it('rejects requests that did not come through the authenticated Worker gateway', async () => {
    const session = new GameSession({} as never, {} as Env);
    expect((await session.fetch(new Request('https://game-session/mutation'))).status).toBe(403);
  });

  it('serializes duplicate payment-request accept commands into one settlement', async () => {
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () => [],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): { acceptPaymentRequest(): Promise<unknown> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    let settlements = 0;
    session.banking = () => ({
      acceptPaymentRequest: async () => {
        settlements += 1;
        return {
          paymentRequest: { id: '00000000-0000-4000-8000-000000000003', state: 'ACCEPTED' },
          transaction: {
            id: commandId,
            gameId,
            type: 'PLAYER_TO_PLAYER',
            amount: 100,
            totalAmount: 100,
            comment: null,
            createdAt: '',
            participants: [],
          },
          players: [],
        };
      },
    });
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    const request = () =>
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'ACCEPT_PAYMENT_REQUEST',
          commandId,
          paymentRequestId: '00000000-0000-4000-8000-000000000003',
        }),
      });
    await Promise.all([
      session.mutate(gameId, 'actor', request()),
      session.mutate(gameId, 'actor', request()),
    ]);
    expect(settlements).toBe(1);
  });

  it('recovers after completion failure: 20 parallel retries leave one transaction and one balance delta', async () => {
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () => [],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): { createTransaction(): Promise<unknown> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger({ failCompleteOnce: true });
    let transactionCount = 0;
    let balanceDelta = 0;
    let persisted = false;
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    session.banking = () => ({
      createTransaction: async () => {
        if (!persisted) {
          persisted = true;
          transactionCount += 1;
          balanceDelta -= 100;
        }
        return {
          transaction: {
            id: commandId,
            gameId,
            type: 'PLAYER_TO_BANK',
            amount: 100,
            totalAmount: 100,
            comment: null,
            createdAt: '',
            participants: [],
          },
          players: [],
        };
      },
    });
    const request = () =>
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'CREATE_TRANSACTION',
          commandId,
          request: {
            type: 'PLAYER_TO_BANK',
            playerId: '00000000-0000-4000-8000-000000000003',
            amount: 100,
          },
        }),
      });
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
      const storage = new Map<string, unknown>();
      const context = {
        storage: {
          get: async <T>(key: string) => storage.get(key) as T | undefined,
          put: async (key: string, value: unknown) => {
            storage.set(key, value);
          },
        },
        getWebSockets: () => [],
      };
      const session = new GameSession(context as never, {} as Env) as unknown as {
        mutate(gameId: string, userId: string, request: Request): Promise<Response>;
        banking(command: string): { createTransaction(): Promise<unknown> };
        authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
        commandLedger(): ReturnType<typeof fakeLedger>;
        afterCommit(stage: string): Promise<void>;
      };
      const ledger = fakeLedger();
      let transactionCount = 0;
      let delta = 0;
      let persisted = false;
      let fail = true;
      session.commandLedger = () => ledger;
      session.authorizeMutation = async () => undefined;
      session.banking = () => ({
        createTransaction: async () => {
          if (!persisted) {
            persisted = true;
            transactionCount += 1;
            delta -= 100;
          }
          return {
            transaction: {
              id: commandId,
              gameId,
              type: 'PLAYER_TO_BANK',
              amount: 100,
              totalAmount: 100,
              comment: null,
              createdAt: '',
              participants: [],
            },
            players: [],
          };
        },
      });
      session.afterCommit = async (current) => {
        if (current === stage && fail) {
          fail = false;
          throw new Error(`Injected ${stage}`);
        }
      };
      const request = () =>
        new Request('https://game-session/mutation', {
          method: 'POST',
          body: JSON.stringify({
            type: 'CREATE_TRANSACTION',
            commandId,
            request: {
              type: 'PLAYER_TO_BANK',
              playerId: '00000000-0000-4000-8000-000000000003',
              amount: 100,
            },
          }),
        });
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

function fakeLedger(options: { failCompleteOnce?: boolean } = {}) {
  const entries = new Map<
    string,
    {
      actorId: string;
      commandType: string;
      payloadHash: string;
      status: 'PENDING' | 'COMPLETED';
      resultStatus: number | null;
      resultJson: string | null;
      resultTransactionId: string | null;
    }
  >();
  return {
    claim: async (input: {
      gameId: string;
      commandId: string;
      actorId: string;
      commandType: string;
      payloadHash: string;
    }) => {
      const existing = entries.get(input.commandId);
      if (existing === undefined) {
        const entry = {
          actorId: input.actorId,
          commandType: input.commandType,
          payloadHash: input.payloadHash,
          status: 'PENDING' as const,
          resultStatus: null,
          resultJson: null,
          resultTransactionId: null,
        };
        entries.set(input.commandId, entry);
        return { gameId: input.gameId, commandId: input.commandId, ...entry };
      }
      return { gameId: input.gameId, commandId: input.commandId, ...existing };
    },
    complete: async (input: {
      gameId: string;
      commandId: string;
      status: number;
      result: unknown;
      transactionId: string | null;
    }) => {
      if (options.failCompleteOnce === true) {
        options.failCompleteOnce = false;
        throw new Error('Injected completion failure');
      }
      const entry = entries.get(input.commandId);
      if (entry === undefined) throw new Error('Missing command');
      entry.status = 'COMPLETED';
      entry.resultStatus = input.status;
      entry.resultJson = JSON.stringify(input.result);
      entry.resultTransactionId = input.transactionId;
    },
  };
}

describe('GameSession reversal authorization', () => {
  const transactionId = '00000000-0000-4000-8000-0000000000bb';
  const stored = {
    id: transactionId,
    gameId,
    type: 'PLAYER_TO_BANK',
    amount: 100,
    totalAmount: 100,
    comment: null,
    createdAt: '2026-01-01 10:00:00',
    participants: [{ playerId: '00000000-0000-4000-8000-000000000003', balanceDelta: -100 }],
  };
  const command = {
    type: 'CREATE_TRANSACTION',
    commandId,
    request: { type: 'REVERSAL', transactionId },
  };

  function sessionWith(found: typeof stored | null) {
    const session = new GameSession({} as never, {} as Env) as unknown as {
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      access(): unknown;
      banking(command: string): unknown;
    };
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
    const sent: string[] = [];
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () => [{ send: (message: string) => sent.push(message) }],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): unknown;
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const mortgages = [{ id: 'm1', propertyName: 'Boardwalk' }];
    session.banking = () => ({
      createTransaction: async () => ({
        transaction: {
          id: commandId,
          gameId,
          type: 'MORTGAGE',
          amount: 100,
          totalAmount: 100,
          comment: 'Boardwalk',
          createdAt: '',
          participants: [],
        },
        players: [],
        mortgages,
      }),
    });
    session.commandLedger = () => fakeLedger();
    session.authorizeMutation = async () => undefined;

    await session.mutate(
      gameId,
      'actor',
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'CREATE_TRANSACTION',
          commandId,
          request: {
            type: 'MORTGAGE',
            playerId: '00000000-0000-4000-8000-000000000003',
            propertyName: 'Boardwalk',
            amount: 100,
          },
        }),
      }),
    );

    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({ type: 'GAME_COMMITTED', mortgages });
  });
});

describe('GameSession bank loan events', () => {
  it('sends the loans and cooldowns with every committed transaction', async () => {
    const sent: string[] = [];
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () => [{ send: (message: string) => sent.push(message) }],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): unknown;
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const loans = [{ id: 'l1', lenderKind: 'BANK', rounds: { round: 2 } }];
    const bankLoanCooldowns = [{ playerId: 'p1', roundsLeft: 1 }];
    session.banking = () => ({
      createTransaction: async () => ({
        transaction: {
          id: commandId,
          gameId,
          type: 'PASS_GO',
          amount: 200,
          totalAmount: 200,
          comment: null,
          createdAt: '',
          participants: [],
        },
        players: [],
        loans,
        bankLoanCooldowns,
      }),
    });
    session.commandLedger = () => fakeLedger();
    session.authorizeMutation = async () => undefined;

    await session.mutate(
      gameId,
      'actor',
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({
          type: 'CREATE_TRANSACTION',
          commandId,
          request: { type: 'PASS_GO', playerId: '00000000-0000-4000-8000-000000000003' },
        }),
      }),
    );

    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      type: 'GAME_COMMITTED',
      loans,
      bankLoanCooldowns,
    });
  });
});

describe('GameSession jackpot events', () => {
  it('sends the pot with a committed transaction, and omits it without the rule', async () => {
    const run = async (jackpot: number | undefined) => {
      const sent: string[] = [];
      const storage = new Map<string, unknown>();
      const context = {
        storage: {
          get: async <T>(key: string) => storage.get(key) as T | undefined,
          put: async (key: string, value: unknown) => {
            storage.set(key, value);
          },
        },
        getWebSockets: () => [{ send: (message: string) => sent.push(message) }],
      };
      const session = new GameSession(context as never, {} as Env) as unknown as {
        mutate(gameId: string, userId: string, request: Request): Promise<Response>;
        banking(command: string): unknown;
        authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
        commandLedger(): ReturnType<typeof fakeLedger>;
      };
      session.banking = () => ({
        createTransaction: async () => ({
          transaction: {
            id: commandId,
            gameId,
            type: 'JACKPOT_PAYOUT',
            amount: 275,
            totalAmount: 275,
            comment: null,
            createdAt: '',
            participants: [],
          },
          players: [],
          ...(jackpot === undefined ? {} : { jackpot }),
        }),
      });
      session.commandLedger = () => fakeLedger();
      session.authorizeMutation = async () => undefined;
      await session.mutate(
        gameId,
        'actor',
        new Request('https://game-session/mutation', {
          method: 'POST',
          body: JSON.stringify({
            type: 'CREATE_TRANSACTION',
            commandId,
            request: {
              type: 'JACKPOT_PAYOUT',
              playerId: '00000000-0000-4000-8000-000000000003',
              expectedAmount: 275,
            },
          }),
        }),
      );
      return JSON.parse(sent[0] ?? '{}') as Record<string, unknown>;
    };

    expect(await run(0)).toMatchObject({ type: 'GAME_COMMITTED', jackpot: 0 });
    expect(await run(undefined)).not.toHaveProperty('jackpot');
  });
});

describe('GameSession trade requests', () => {
  const tradeRequestId = '00000000-0000-4000-8000-0000000000d1';
  const proposer = '00000000-0000-4000-8000-0000000000d2';
  const counterparty = '00000000-0000-4000-8000-0000000000d3';
  const stored = {
    id: tradeRequestId,
    proposerPlayerId: proposer,
    counterpartyPlayerId: counterparty,
  };

  type Internals = {
    mutate(gameId: string, userId: string, request: Request): Promise<Response>;
    banking(command: string): unknown;
    access(): unknown;
    authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
    commandLedger(): ReturnType<typeof fakeLedger>;
  };
  function build() {
    const sent: string[] = [];
    const storage = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
      getWebSockets: () => [{ send: (message: string) => sent.push(message) }],
    };
    const session = new GameSession(context as never, {} as Env) as unknown as Internals;
    const controlled: string[] = [];
    session.access = () => ({
      requireMember: async () => 'PLAYER',
      requirePlayerController: async (_gameId: string, _userId: string, playerId: string) => {
        controlled.push(playerId);
      },
    });
    return { session, sent, controlled };
  }
  const send = (session: Internals, command: Record<string, unknown>) =>
    session.mutate(
      gameId,
      'actor',
      new Request('https://game-session/mutation', {
        method: 'POST',
        body: JSON.stringify({ commandId, ...command }),
      }),
    );
  const accepted = {
    tradeRequest: { ...stored, state: 'ACCEPTED' },
    transaction: {
      id: commandId,
      gameId,
      type: 'PROPERTY_TRANSFER',
      amount: 0,
      totalAmount: 0,
      comment: null,
      createdAt: '',
      participants: [],
    },
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
    const ledger = fakeLedger();
    session.commandLedger = () => ledger;
    const command = { type: 'ACCEPT_TRADE_REQUEST', tradeRequestId };
    await Promise.all([send(session, command), send(session, command)]);
    await send(session, command);
    expect(settlements).toBe(1);
    const types = sent.map((message) => (JSON.parse(message) as { type: string }).type);
    expect(types).toEqual(['GAME_COMMITTED', 'PAYMENT_REQUESTS_UPDATED']);
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
    session.commandLedger = () => fakeLedger();
    const ids = ['1', '2', '3'].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    const commands: Array<Record<string, unknown>> = [
      { type: 'CREATE_TRADE_REQUEST', request: { id: tradeRequestId, playerId: proposer } },
      { type: 'DECLINE_TRADE_REQUEST', tradeRequestId },
      { type: 'CANCEL_TRADE_REQUEST', tradeRequestId },
    ];
    for (const [index, command] of commands.entries())
      await send(session, { ...command, commandId: ids[index] });
    expect(sent.map((message) => (JSON.parse(message) as { type: string }).type)).toEqual([
      'PAYMENT_REQUESTS_UPDATED',
      'PAYMENT_REQUESTS_UPDATED',
      'PAYMENT_REQUESTS_UPDATED',
    ]);
  });
});
