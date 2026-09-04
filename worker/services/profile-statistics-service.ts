import type { GameCompletionRepository } from '../repositories/game-completion-repository.js';

export class ProfileStatisticsService {
  private readonly completions: GameCompletionRepository;
  constructor(completions: GameCompletionRepository) { this.completions = completions; }
  async recordCompletedGame(gameId: string, participants: readonly { userId: string; won: boolean }[]): Promise<void> {
    for (const participant of participants) await this.completions.record(gameId, participant.userId, participant.won);
  }
}
