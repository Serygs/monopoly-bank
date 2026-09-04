import { describe, expect, it } from 'vitest';
import { ProfileStatisticsService } from './profile-statistics-service.js';

describe('ProfileStatisticsService', () => {
  it('increments each participant only once when finish is retried', async () => {
    const rows = new Set<string>(); const increments: Array<{ userId: string; won: boolean }> = [];
    const service = new ProfileStatisticsService({ record: async (gameId, userId) => { const key = `${gameId}:${userId}`; if (rows.has(key)) return false; rows.add(key); return true; }, incrementProfile: async (userId, won) => { increments.push({ userId, won }); } });
    await service.recordCompletedGame('game', [{ userId: 'winner', won: true }, { userId: 'other', won: false }]);
    await service.recordCompletedGame('game', [{ userId: 'winner', won: true }, { userId: 'other', won: false }]);
    expect(increments).toEqual([{ userId: 'winner', won: true }, { userId: 'other', won: false }]);
  });
});
