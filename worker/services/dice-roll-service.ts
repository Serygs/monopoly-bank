import type { DiceRoll, RecordDiceRollRequest } from '../../shared/contracts/api.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { DiceRollRepository } from '../repositories/dice-roll-repository.js';
import { ConflictError, ResourceNotFoundError } from './errors.js';

export interface DiceRollService {
  record(gameId: string, playerId: string, input: RecordDiceRollRequest): Promise<DiceRoll>;
  list(gameId: string, playerId: string, limit: number): Promise<DiceRoll[]>;
}

export interface DiceRollServiceDependencies {
  games: Pick<GameRepository, 'getById'>;
  rolls: DiceRollRepository;
}

/** Dice history of one player for the length of an active game; it never changes game state. */
export class DefaultDiceRollService implements DiceRollService {
  private readonly games: Pick<GameRepository, 'getById'>;
  private readonly rolls: DiceRollRepository;

  constructor(dependencies: DiceRollServiceDependencies) {
    this.games = dependencies.games;
    this.rolls = dependencies.rolls;
  }

  async record(gameId: string, playerId: string, input: RecordDiceRollRequest): Promise<DiceRoll> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    if (game.status !== 'ACTIVE')
      throw new ConflictError('INVALID_GAME_STATE', 'Dice can only be rolled in an active game.');
    const stored = await this.rolls.record({ ...input, gameId, playerId });
    if (stored === null)
      throw new ConflictError('DICE_ROLL_ID_REUSED', 'This roll ID belongs to a different roll.');
    return stored;
  }

  async list(gameId: string, playerId: string, limit: number): Promise<DiceRoll[]> {
    if ((await this.games.getById(gameId)) === null) throw new ResourceNotFoundError('Game');
    return this.rolls.listForPlayer(gameId, playerId, limit);
  }
}
