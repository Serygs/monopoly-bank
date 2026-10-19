// @vitest-environment node
import './test-support/auto-response-stub.js';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameSession } from './game-session.js';
import { d1, migratedDatabase, seedUsers } from './test-support/sqlite-d1.js';

const GAME = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const START = 1500;

interface Internals {
  afterCommit(stage: string): Promise<void>;
}

function session(database: DatabaseSync): GameSession {
  const storage = new Map<string, unknown>();
  const context = {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    setWebSocketAutoResponse: () => undefined,
    getWebSockets: () => [],
  };
  return new GameSession(
    context as unknown as DurableObjectState,
    {
      MONOPOLY_BANK_DB: d1(database),
    } as unknown as Env,
  );
}

function transfer(commandId: string, from: string, to: string, amount: number) {
  return {
    type: 'CREATE_TRANSACTION',
    commandId,
    request: { type: 'PLAYER_TO_PLAYER', sourcePlayerId: from, destinationPlayerId: to, amount },
  };
}

function mutate(target: GameSession, userId: string, command: unknown): Promise<Response> {
  return target.fetch(
    new Request('https://game-session/mutation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-game-id': GAME, 'x-user-id': userId },
      body: JSON.stringify(command),
    }),
  );
}

function count(database: DatabaseSync, sql: string): number {
  return (database.prepare(sql).get() as { n: number }).n;
}

function writes(database: DatabaseSync): number {
  return count(database, 'SELECT total_changes() AS n');
}

function balances(database: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    database
      .prepare('SELECT id, balance FROM players ORDER BY id')
      .all()
      .map((row) => [(row as { id: string }).id, (row as { balance: number }).balance]),
  );
}

describe('GameSession command ledger on SQLite', () => {
  let database: DatabaseSync;
  let game: GameSession;

  beforeEach(async () => {
    database = await migratedDatabase();
    seedUsers(database, ['ua', 'ub']);
    database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, owner_user_id)
         VALUES (?, 'Ledger', ?, 200, 'UAH', 'ACTIVE', 'FAST', 'ua')`,
      )
      .run(GAME, START);
    for (const [player, user, role] of [
      [A, 'ua', 'OWNER'],
      [B, 'ub', 'PLAYER'],
    ] as const) {
      database
        .prepare(
          "INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, '#000000', ?)",
        )
        .run(player, GAME, user, START);
      database
        .prepare('INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, ?, ?)')
        .run(GAME, user, role, player);
      database
        .prepare(
          "INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES (?, ?, ?, 'PRIMARY')",
        )
        .run(GAME, player, user);
    }
    game = session(database);
  });

  it('records a completed command once and replays it without writing', async () => {
    const command = transfer('00000000-0000-4000-8000-0000000000c1', A, B, 100);
    const first = await mutate(game, 'ua', command);
    expect(first.status).toBe(201);
    expect(count(database, 'SELECT COUNT(*) AS n FROM command_ledger')).toBe(1);
    const before = writes(database);
    const replay = await mutate(session(database), 'ua', command);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(writes(database)).toBe(before);
    expect(balances(database)).toEqual({ [A]: START - 100, [B]: START + 100 });
  });

  it('writes nothing for a command that is refused', async () => {
    const before = writes(database);
    const refused = await mutate(
      game,
      'ua',
      transfer('00000000-0000-4000-8000-0000000000c2', A, B, START + 1),
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(writes(database)).toBe(before);
    expect(count(database, 'SELECT COUNT(*) AS n FROM command_ledger')).toBe(0);
  });

  it('never moves the money twice when the session fails after the commit', async () => {
    const command = transfer('00000000-0000-4000-8000-0000000000c3', A, B, 250);
    const failing = session(database);
    (failing as unknown as Internals).afterCommit = async (stage) => {
      if (stage === 'executed') throw new Error('crash after commit');
    };
    expect((await mutate(failing, 'ua', command)).ok).toBe(false);
    await mutate(session(database), 'ua', command);
    expect(balances(database)).toEqual({ [A]: START - 250, [B]: START + 250 });
    expect(count(database, 'SELECT COUNT(*) AS n FROM transactions')).toBe(1);
  });

  it('keeps every wallet equal to its ledger under concurrent commands', async () => {
    const commands = Array.from({ length: 12 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      return index % 2 === 0
        ? mutate(game, 'ua', transfer(id, A, B, 10 + index))
        : mutate(game, 'ub', transfer(id, B, A, 5 + index));
    });
    const responses = await Promise.all(commands);
    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(201));
    const totals = balances(database);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(START * 2);
    const ledger = database
      .prepare(
        'SELECT player_id AS id, SUM(balance_delta) AS delta FROM transaction_participants GROUP BY player_id',
      )
      .all() as { id: string; delta: number }[];
    for (const row of ledger) expect(totals[row.id]).toBe(START + row.delta);
    expect(count(database, 'SELECT COUNT(*) AS n FROM command_ledger')).toBe(12);
  });
});
