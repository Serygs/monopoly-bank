import type { GameDetails } from '../../shared/contracts/api.js';
import type { GameStatisticsRepository } from '../repositories/game-statistics-repository.js';
import { ConflictError } from './errors.js';
import type { GameAccessService } from './game-access-service.js';
import type { GameService } from './game-service.js';
import type { ProfileStatisticsService } from './profile-statistics-service.js';

export interface GameFinishDependencies {
  games: GameService;
  access: GameAccessService;
  profileStatistics: ProfileStatisticsService;
  statistics?: GameStatisticsRepository;
}

export async function finishGameWithStatistics(
  dependencies: GameFinishDependencies,
  gameId: string,
  existing: GameDetails,
  winnerPlayerIds: readonly string[],
): Promise<GameDetails> {
  const { statistics } = dependencies;
  if (statistics === undefined)
    throw new ConflictError('STATISTICS_UNAVAILABLE', 'Statistics are not configured.');
  await statistics.saveFinalSnapshot(
    gameId,
    winnerPlayerIds,
    await statistics.calculate(existing.game, existing.players),
  );
  const details = await dependencies.games.finishGame(gameId);
  const winnerIds = new Set(winnerPlayerIds);
  const participants = (await dependencies.access.linkedMembers(gameId))
    .filter((member) => member.playerId !== null)
    .map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) }));
  await dependencies.profileStatistics.recordCompletedGame(gameId, participants);
  return details;
}
