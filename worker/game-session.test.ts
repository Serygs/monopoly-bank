import { describe, expect, it } from 'vitest';
import { GameSession } from './game-session.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';

describe('GameSession live coordinator', () => {
  it('broadcasts one authoritative update to every client and replays duplicate command IDs', async () => {
    const sent: string[][] = [[], []];
    const storage = new Map<string, unknown>();
    const context = {
      storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } },
      getWebSockets: () => sent.map((messages) => ({ send: (message: string) => messages.push(message) })),
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, request: Request): Promise<Response>;
      banking(command: string): { createTransaction(): Promise<unknown> };
    };
    let calls = 0;
    session.banking = () => ({ createTransaction: async () => {
      calls += 1;
      return { transaction: { id: commandId, gameId, type: 'PLAYER_TO_BANK', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }, players: [] };
    } });
    const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'CREATE_TRANSACTION', commandId, request: { type: 'PLAYER_TO_BANK', playerId: '00000000-0000-4000-8000-000000000003', amount: 100 } }) });

    expect((await session.mutate(gameId, request())).status).toBe(201);
    expect((await session.mutate(gameId, request())).status).toBe(201);
    expect(calls).toBe(1);
    expect(sent[0]).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(JSON.parse(sent[0][0])).toMatchObject({ type: 'TRANSACTION_CREATED', transaction: { id: commandId } });
  });

  it('rejects requests that did not come through the authenticated Worker gateway', async () => {
    const session = new GameSession({} as never, {} as Env);
    expect((await session.fetch(new Request('https://game-session/mutation'))).status).toBe(403);
  });
});
