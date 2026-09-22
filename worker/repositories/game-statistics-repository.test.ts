import { describe, expect, it } from 'vitest';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';

const game = { id: 'game', name: 'Fixture table', startingBalance: 1500, passGoReward: 200, currency: 'K' as const, paymentMode: 'FAST' as const, status: 'FINISHED' as const, createdAt: '', updatedAt: '', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T01:00:00.000Z' };
const players = [{ id: 'a', gameId: 'game', name: 'Ada', color: '#123', balance: 2000, status: 'ACTIVE' as const, createdAt: '' }, { id: 'b', gameId: 'game', name: 'Bea', color: '#456', balance: 1000, status: 'ACTIVE' as const, createdAt: '' }];

describe('D1 game statistics', () => {
  it('aggregates a fixture larger than 1000 ledger rows without a history limit', async () => {
    const fixture = Array.from({ length: 1001 }, (_, index) => index + 1);
    const database = new StatisticsDatabase(fixture.length);
    const summary = await new D1GameStatisticsRepository(database as unknown as D1Database).calculate(game, players);
    expect(summary.totalTransactions).toBe(1001);
    expect(summary.totalMoneyTransferred).toBe(50_050);
    expect(summary.cashLeaderboard[0].player.id).toBe('a');
    expect(database.queries[0]).not.toMatch(/LIMIT\s+100/i);
  });

  it('does not bind wallet IDs when loading all game activity', async () => {
    const database = new ActivityDatabase();

    await new D1GameStatisticsRepository(database as unknown as D1Database).activity('game', 'ALL', ['wallet-a', 'wallet-b'], null, 100);

    expect(database.bindings).toEqual([['game', 101]]);
  });

  it('binds wallet IDs only when loading activity for the current player', async () => {
    const database = new ActivityDatabase();

    await new D1GameStatisticsRepository(database as unknown as D1Database).activity('game', 'MINE', ['wallet-a', 'wallet-b'], null, 100);

    expect(database.bindings).toEqual([['game', 'wallet-a', 'wallet-b', 101]]);
  });

  it('writes the capital ranking and the deed table of a board game into summary_json', async () => {
    const database = new SnapshotDatabase(null);
    const summary = { ...emptySummary(), netWorth: [{ player: players[0], netWorth: 2600 }, { player: players[1], netWorth: 1000 }], propertyOwnership: [{ boardSpaceId: 'board-classic-space-39', ownerPlayerId: 'a', houses: 1, mortgaged: false }] };
    await new D1GameStatisticsRepository(database as unknown as D1Database).saveFinalSnapshot('game', ['a'], summary);
    expect(database.bindings[0][0]).toBe('game');
    expect(JSON.parse(database.bindings[0][1] as string)).toEqual(['a']);
    const stored = JSON.parse(database.bindings[0][2] as string) as typeof summary;
    expect(stored.netWorth.map((entry) => [entry.player.id, entry.netWorth])).toEqual([['a', 2600], ['b', 1000]]);
    expect(stored.propertyOwnership).toEqual(summary.propertyOwnership);
  });

  it('reads the snapshot of a game finished before the board subsystem without either field and without error', async () => {
    const database = new SnapshotDatabase({ winner_player_ids_json: '["b"]', summary_json: JSON.stringify(emptySummary()) });
    const snapshot = await new D1GameStatisticsRepository(database as unknown as D1Database).getFinalSnapshot('game');
    expect(snapshot?.winnerPlayerIds).toEqual(['b']);
    expect(snapshot?.summary.totalTransactions).toBe(0);
    expect(snapshot?.summary).not.toHaveProperty('netWorth');
    expect(snapshot?.summary).not.toHaveProperty('propertyOwnership');
  });
});

function emptySummary() {
  return { durationMs: 0, totalTransactions: 0, totalMoneyTransferred: 0, largestSinglePayment: 0, richestActivePlayer: null, lowestActiveBalance: null, players: [], playerToPlayerTotal: 0, paidToBank: 0, receivedFromBank: 0, largestTransaction: 0, biggestSenderId: null, leastSenderId: null, biggestPayerRecipient: null, cashLeaderboard: [] };
}

class SnapshotDatabase {
  readonly bindings: unknown[][] = [];
  constructor(private readonly row: { winner_player_ids_json: string; summary_json: string } | null) {}
  prepare() {
    return {
      bind: (...values: unknown[]) => {
        this.bindings.push(values);
        return { run: async () => ({ meta: { changes: 1 } }), first: async () => this.row };
      },
    };
  }
}

class ActivityDatabase {
  readonly bindings: unknown[][] = [];
  prepare() {
    return {
      bind: (...values: unknown[]) => {
        this.bindings.push(values);
        return { all: async () => ({ results: [] }) };
      },
    };
  }
}

class StatisticsDatabase {
  readonly queries: string[] = [];
  private readonly count: number;
  constructor(count: number) { this.count = count; }
  prepare(query: string) { this.queries.push(query); return { bind: () => ({ first: async () => query.includes('COUNT(*)') ? { count: this.count, moved: 50_050, largest: 100, p2p: 25_000, paid_bank: 10_000, received_bank: 15_050 } : null, all: async () => ({ results: [{ player_id: 'a', sent: 500, received: 1000, transaction_count: this.count, pass_go_count: 10 }, { player_id: 'b', sent: 1000, received: 500, transaction_count: this.count, pass_go_count: 8 }] }) }) }; }
}
