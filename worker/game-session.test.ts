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
