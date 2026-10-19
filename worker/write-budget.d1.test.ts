import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import './test-support/auto-response-stub.js';
import type { GameDetails, TradeRequest } from '../shared/contracts/api.js';
import worker, { GameSession } from './index.js';

const execFile = promisify(execFileCallback);
const enabled = process.env.D1_WRITE_BUDGET === '1';
const ORIGIN = 'http://localhost';

const BUDGET: Record<string, number> = {
  'create lobby': 72,
  join: 18,
  start: 4,
  transfer: 20,
  'pass go': 12,
  'property purchase': 16,
  'pay rent': 16,
  'trade request': 8,
  'trade accept': 28,
  mortgage: 22,
  'dice roll': 3,
  reconnect: 0,
  'tab switch': 0,
  finish: 42,
  'deferred cleanup': 36,
};
const SCENARIO_BUDGET = 829;

interface Usage {
  written: number;
  read: number;
}

interface Meta {
  rows_written?: number;
  rows_read?: number;
}

class Meter {
  written = 0;
  read = 0;
  add(meta: Meta | undefined): void {
    this.written += meta?.rows_written ?? 0;
    this.read += meta?.rows_read ?? 0;
  }
  async measure(task: () => Promise<unknown>): Promise<Usage> {
    const written = this.written;
    const read = this.read;
    await task();
    return { written: this.written - written, read: this.read - read };
  }
}

const inner = new WeakMap<object, D1PreparedStatement>();

function meteredStatement(statement: D1PreparedStatement, meter: Meter): D1PreparedStatement {
  const wrapped = {
    bind: (...values: unknown[]) => meteredStatement(statement.bind(...values), meter),
    run: async () => {
      const result = await statement.run();
      meter.add(result.meta);
      return result;
    },
    all: async () => {
      const result = await statement.all();
      meter.add(result.meta);
      return result;
    },
    first: async (column?: string) => {
      const result = await statement.all<Record<string, unknown>>();
      meter.add(result.meta);
      const row = result.results[0];
      if (row === undefined) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
    raw: (options?: { columnNames?: boolean }) => statement.raw(options as { columnNames: true }),
  };
  inner.set(wrapped, statement);
  return wrapped as unknown as D1PreparedStatement;
}

function meteredDatabase(database: D1Database, meter: Meter): D1Database {
  return {
    prepare: (sql: string) => meteredStatement(database.prepare(sql), meter),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = await database.batch(
        statements.map((statement) => inner.get(statement) ?? statement),
      );
      for (const result of results) meter.add(result.meta);
      return results;
    },
    exec: (sql: string) => database.exec(sql),
  } as unknown as D1Database;
}

class FakeSocket {
  private attachment: unknown = null;
  send(): void {}
  close(): void {}
  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

Object.assign(globalThis, {
  WebSocketPair: class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  },
});

function sessionNamespace(env: () => Env): DurableObjectNamespace {
  const objects = new Map<string, GameSession>();
  const create = (name: string): GameSession => {
    const storage = new Map<string, unknown>();
    const sockets: FakeSocket[] = [];
    const context = {
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        delete: async (key: string) => storage.delete(key),
        setAlarm: async () => undefined,
        deleteAlarm: async () => undefined,
      },
      setWebSocketAutoResponse: () => undefined,
      acceptWebSocket: (socket: FakeSocket) => {
        sockets.push(socket);
      },
      getWebSockets: () => sockets,
    };
    const session = new GameSession(context as unknown as DurableObjectState, env());
    objects.set(name, session);
    return session;
  };
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (request: Request) => {
        const session = objects.get(id) ?? create(id);
        try {
          return await session.fetch(request);
        } catch (error) {
          if (error instanceof RangeError) return new Response(null, { status: 204 });
          throw error;
        }
      },
    }),
  } as unknown as DurableObjectNamespace;
}

class Client {
  private cookie = '';
  private readonly call: (request: Request) => Promise<Response>;
  constructor(call: (request: Request) => Promise<Response>) {
    this.call = call;
  }
  async send<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: HeadersInit = {},
  ): Promise<T> {
    const response = await this.call(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          'x-command-id': crypto.randomUUID(),
          cookie: this.cookie,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const cookie = response.headers.get('set-cookie');
    if (cookie !== null) this.cookie = cookie.split(';')[0] ?? '';
    const text = await response.text();
    if (!response.ok && response.status !== 204)
      throw new Error(`${method} ${path} -> ${response.status} ${text}`);
    if (text === '') return null as T;
    return (JSON.parse(text) as { data: T }).data;
  }
}

describe.skipIf(!enabled)('D1 rows written per operation', () => {
  const meter = new Meter();
  const usage = new Map<string, Usage[]>();
  let persistence = '';
  let dispose: () => Promise<void> = async () => undefined;
  let owner: Client;
  let guest: Client;
  let game: GameDetails;
  let database: D1Database;

  const record = async (operation: string, task: () => Promise<unknown>) => {
    const result = await meter.measure(task);
    usage.set(operation, [...(usage.get(operation) ?? []), result]);
  };

  beforeAll(async () => {
    persistence = await mkdtemp(join(tmpdir(), 'monopoly-bank-write-budget-'));
    const wrangler = fileURLToPath(
      new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
    );
    await execFile(process.execPath, [
      wrangler,
      'd1',
      'migrations',
      'apply',
      'MONOPOLY_BANK_DB',
      '--local',
      '--persist-to',
      persistence,
    ]);
    const proxy = await getPlatformProxy<{ MONOPOLY_BANK_DB: D1Database }>({
      configPath: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      persist: { path: join(persistence, 'v3') },
    });
    dispose = () => proxy.dispose();
    database = meteredDatabase(proxy.env.MONOPOLY_BANK_DB, meter);
    const env = {
      MONOPOLY_BANK_DB: database,
      GAME_SESSIONS: sessionNamespace(() => env as unknown as Env),
      OPERATIONAL_METRICS: { writeDataPoint: () => undefined },
      RESEND_API_KEY: 'test',
      RESEND_FROM_EMAIL: 'test@example.com',
      APP_ORIGIN: ORIGIN,
    };
    const call = (request: Request) =>
      worker.fetch(
        request as Parameters<typeof worker.fetch>[0],
        env as unknown as Env,
        {} as ExecutionContext,
      );
    owner = new Client(call);
    guest = new Client(call);
  }, 120_000);

  afterAll(async () => {
    await dispose();
    if (persistence !== '') await rm(persistence, { recursive: true, force: true });
  });

  it('plays the scenario and reports rows written', async () => {
    await owner.send('POST', '/api/auth/register', {
      nickname: 'owner',
      avatar: 'a',
      password: 'correct horse battery',
    });
    await guest.send('POST', '/api/auth/register', {
      nickname: 'guest',
      avatar: 'b',
      password: 'correct horse battery',
    });
    await record('create lobby', async () => {
      game = await owner.send<GameDetails>('POST', '/api/games', {
        name: 'Budget',
        startingBalance: 15000,
        passGoReward: 2000,
        currency: 'UAH',
        board: 'monopoly-ru-2012',
        gameAccessPassword: 'table-password',
        players: [{ name: 'owner', color: '#e05263' }],
      });
    });
    const gameId = game.game.id;
    const { joinCode } = await owner.send<GameDetails>('GET', `/api/games/${gameId}`);
    await record('join', () =>
      guest.send('POST', '/api/games/join', { joinCode, gameAccessPassword: 'table-password' }),
    );
    await record('start', () => owner.send('POST', `/api/games/${gameId}/start`));
    const details = await owner.send<GameDetails>('GET', `/api/games/${gameId}`);
    const [a, b] = ['owner', 'guest'].map(
      (name) => details.players.find((player) => player.name === name)?.id,
    );
    if (a === undefined || b === undefined) throw new Error('two players expected');
    const pay = (client: Client, body: Record<string, unknown>) =>
      client.send('POST', `/api/games/${gameId}/transactions`, body);
    const amounts = [100, 200, 300, 400, 500];
    for (let index = 0; index < 20; index += 1) {
      const amount = amounts[index % amounts.length] ?? 100;
      const kind = index % 3;
      await record('transfer', () =>
        kind === 0
          ? pay(owner, {
              type: 'PLAYER_TO_PLAYER',
              sourcePlayerId: a,
              destinationPlayerId: b,
              amount,
            })
          : kind === 1
            ? pay(guest, { type: 'PLAYER_TO_BANK', playerId: b, amount })
            : pay(owner, { type: 'BANK_TO_PLAYER', playerId: a, amount }),
      );
    }
    await record('pass go', () => pay(owner, { type: 'PASS_GO', playerId: a }));
    const tiles = ['zhitna', 'nagatinska', 'varshavske', 'ogarova', 'persha_parkova'];
    for (const [index, tileId] of tiles.entries())
      await record('property purchase', () =>
        index < 3
          ? pay(owner, { type: 'PROPERTY_PURCHASE', playerId: a, tileId })
          : pay(guest, { type: 'PROPERTY_PURCHASE', playerId: b, tileId }),
      );
    await record('pay rent', () =>
      pay(guest, { type: 'PAY_RENT', payerPlayerId: b, tileId: 'varshavske' }),
    );
    const trades: [string, string][] = [
      ['zhitna', 'ogarova'],
      ['nagatinska', 'persha_parkova'],
    ];
    for (const [give, take] of trades) {
      const id = crypto.randomUUID();
      await record('trade request', () =>
        owner.send<{ tradeRequest: TradeRequest }>('POST', `/api/games/${gameId}/trade-requests`, {
          id,
          playerId: a,
          counterpartyPlayerId: b,
          giveTileIds: [give],
          takeTileIds: [take],
          cashGive: 50,
          cashTake: 0,
        }),
      );
      await record('trade accept', () =>
        guest.send('POST', `/api/games/${gameId}/trade-requests/${id}/accept`),
      );
    }
    for (const tileId of ['varshavske', 'ogarova'])
      await record('mortgage', () => pay(owner, { type: 'MORTGAGE', playerId: a, tileId }));
    for (let index = 0; index < 30; index += 1) {
      const [client, playerId] = index % 2 === 0 ? [owner, a] : [guest, b];
      await record('dice roll', () =>
        client.send('POST', `/api/games/${gameId}/players/${playerId}/dice-rolls`, {
          id: crypto.randomUUID(),
          dieOne: (index % 6) + 1,
          dieTwo: ((index + 2) % 6) + 1,
        }),
      );
    }
    for (let index = 0; index < 10; index += 1)
      await record('reconnect', () =>
        owner.send('GET', `/api/games/${gameId}/live`, undefined, { upgrade: 'websocket' }),
      );
    for (let index = 0; index < 10; index += 1)
      await record('tab switch', async () => {
        await guest.send('GET', `/api/games/${gameId}/version`);
        await guest.send('GET', `/api/games/${gameId}`);
        await guest.send('GET', `/api/games/${gameId}/trade-requests`);
        await guest.send('GET', `/api/games/${gameId}/payment-requests`);
        await guest.send('GET', `/api/games/${gameId}/activity?scope=PENDING`);
      });
    await record('finish', () =>
      owner.send('POST', `/api/games/${gameId}/finish`, { winnerPlayerIds: [a] }),
    );
    await record('deferred cleanup', () =>
      database.prepare('DELETE FROM command_ledger WHERE game_id = ?').bind(gameId).run(),
    );

    const report = [...usage.entries()].map(([operation, runs]) => {
      const written = runs.reduce((sum, run) => sum + run.written, 0);
      const read = runs.reduce((sum, run) => sum + run.read, 0);
      return {
        operation,
        count: runs.length,
        writtenPerCall: Math.round((written / runs.length) * 10) / 10,
        writtenMax: Math.max(...runs.map((run) => run.written)),
        writtenTotal: written,
        readTotal: read,
      };
    });
    const total = report.reduce((sum, row) => sum + row.writtenTotal, 0);
    const reportPath = process.env.D1_WRITE_BUDGET_REPORT;
    if (reportPath !== undefined)
      await writeFile(reportPath, JSON.stringify({ report, total }, null, 2));

    const ledger = await database
      .prepare(
        `SELECT p.id, p.balance, ? + COALESCE(SUM(tp.balance_delta), 0) AS expected
         FROM players p LEFT JOIN transaction_participants tp ON tp.player_id = p.id AND tp.game_id = p.game_id
         WHERE p.game_id = ? GROUP BY p.id`,
      )
      .bind(game.game.startingBalance, gameId)
      .all<{ id: string; balance: number; expected: number }>();
    expect(ledger.results).toHaveLength(2);
    for (const row of ledger.results) expect(row.balance).toBe(row.expected);
    expect(Object.fromEntries(report.map((row) => [row.operation, row.writtenMax]))).toEqual(
      Object.fromEntries(Object.keys(BUDGET).map((operation) => [operation, expect.any(Number)])),
    );
    for (const row of report)
      expect(row.writtenMax).toBeLessThanOrEqual(BUDGET[row.operation] ?? 0);
    expect(total).toBeLessThanOrEqual(SCENARIO_BUDGET);
  }, 300_000);
});
