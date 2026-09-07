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
});

class StatisticsDatabase {
  readonly queries: string[] = [];
  private readonly count: number;
  constructor(count: number) { this.count = count; }
  prepare(query: string) { this.queries.push(query); return { bind: () => ({ first: async () => query.includes('COUNT(*)') ? { count: this.count, moved: 50_050, largest: 100, p2p: 25_000, paid_bank: 10_000, received_bank: 15_050 } : null, all: async () => ({ results: [{ player_id: 'a', sent: 500, received: 1000, transaction_count: this.count, pass_go_count: 10 }, { player_id: 'b', sent: 1000, received: 500, transaction_count: this.count, pass_go_count: 8 }] }) }) }; }
}
