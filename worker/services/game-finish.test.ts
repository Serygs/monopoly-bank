import { describe, expect, it, vi } from 'vitest';
import { buildGameDetails } from '../../shared/test-support/fixtures.js';
import { finishGameWithStatistics, type GameFinishDependencies } from './game-finish.js';

const existing = buildGameDetails();
const finished = buildGameDetails({ game: { status: 'FINISHED' } });

function fixture(withStatistics = true) {
  const calls: string[] = [];
  const statistics = {
    calculate: vi.fn(async () => {
      calls.push('calculate');
      return { totalMoneyTransferred: 7 };
    }),
    saveFinalSnapshot: vi.fn(async () => {
      calls.push('snapshot');
    }),
  };
  const games = {
    finishGame: vi.fn(async () => {
      calls.push('finish');
      return finished;
    }),
  };
  const access = {
    linkedMembers: vi.fn(async () => [
      { userId: 'u1', playerId: 'p1' },
      { userId: 'u2', playerId: 'p2' },
      { userId: 'u3', playerId: null },
    ]),
  };
  const profileStatistics = {
    recordCompletedGame: vi.fn(async () => {
      calls.push('record');
    }),
  };
  const dependencies = {
    games,
    access,
    profileStatistics,
    ...(withStatistics ? { statistics } : {}),
  } as unknown as GameFinishDependencies;
  return { dependencies, statistics, games, profileStatistics, calls };
}

describe('finishGameWithStatistics', () => {
  it('saves the snapshot, finishes the game, then records the winners of linked accounts', async () => {
    const { dependencies, statistics, profileStatistics, calls } = fixture();
    await expect(finishGameWithStatistics(dependencies, 'g', existing, ['p1'])).resolves.toBe(
      finished,
    );
    expect(statistics.saveFinalSnapshot).toHaveBeenCalledWith('g', ['p1'], {
      totalMoneyTransferred: 7,
    });
    expect(profileStatistics.recordCompletedGame).toHaveBeenCalledWith('g', [
      { userId: 'u1', won: true },
      { userId: 'u2', won: false },
    ]);
    expect(calls).toEqual(['calculate', 'snapshot', 'finish', 'record']);
  });

  it('refuses without statistics and writes nothing', async () => {
    const { dependencies, games, profileStatistics } = fixture(false);
    await expect(
      finishGameWithStatistics(dependencies, 'g', existing, ['p1']),
    ).rejects.toMatchObject({ code: 'STATISTICS_UNAVAILABLE' });
    expect(games.finishGame).not.toHaveBeenCalled();
    expect(profileStatistics.recordCompletedGame).not.toHaveBeenCalled();
  });

  it('does not finish the game when the snapshot cannot be saved', async () => {
    const { dependencies, statistics, games } = fixture();
    statistics.saveFinalSnapshot.mockRejectedValue(new Error('down'));
    await expect(finishGameWithStatistics(dependencies, 'g', existing, ['p1'])).rejects.toThrow(
      'down',
    );
    expect(games.finishGame).not.toHaveBeenCalled();
  });
});
