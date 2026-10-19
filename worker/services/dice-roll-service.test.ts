import { describe, expect, it } from 'vitest';
import type { DiceRoll } from '../../shared/contracts/api.js';
import type { Game, GameStatus } from '../../shared/types/monopoly.js';
import type { DiceRollRepository } from '../repositories/dice-roll-repository.js';
import { DefaultDiceRollService } from './dice-roll-service.js';
import { ConflictError, ResourceNotFoundError } from './errors.js';

function game(status: GameStatus): Game {
  return {
    id: 'game-1',
    name: 'Dice',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    status,
    createdAt: '',
    updatedAt: '',
  };
}

const stored: DiceRoll = {
  id: 'roll-1',
  playerId: 'player-1',
  dieOne: 2,
  dieTwo: 5,
  createdAt: '2026-10-15T10:00:00.000Z',
};

function service(options: { game: Game | null; record?: DiceRoll | null }) {
  const recorded: unknown[] = [];
  const rolls: DiceRollRepository = {
    record: async (input) => {
      recorded.push(input);
      return options.record === undefined ? stored : options.record;
    },
    listForPlayer: async () => [stored],
  };
  return {
    recorded,
    service: new DefaultDiceRollService({ games: { getById: async () => options.game }, rolls }),
  };
}

const request = { id: 'roll-1', dieOne: 2, dieTwo: 5 };

describe('DefaultDiceRollService', () => {
  it('records a roll for the player in an active game', async () => {
    const { service: dice, recorded } = service({ game: game('ACTIVE') });
    await expect(dice.record('game-1', 'player-1', request)).resolves.toEqual(stored);
    expect(recorded).toEqual([{ ...request, gameId: 'game-1', playerId: 'player-1' }]);
  });

  it.each(['LOBBY', 'FINISHED'] as const)('refuses to record in a %s game', async (status) => {
    const { service: dice, recorded } = service({ game: game(status) });
    await expect(dice.record('game-1', 'player-1', request)).rejects.toMatchObject({
      code: 'INVALID_GAME_STATE',
    });
    await expect(dice.record('game-1', 'player-1', request)).rejects.toBeInstanceOf(ConflictError);
    expect(recorded).toEqual([]);
  });

  it('reports a missing game', async () => {
    const { service: dice } = service({ game: null });
    await expect(dice.record('game-1', 'player-1', request)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    await expect(dice.list('game-1', 'player-1', 20)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('rejects a roll id that belongs to another player', async () => {
    const { service: dice } = service({ game: game('ACTIVE'), record: null });
    await expect(dice.record('game-1', 'player-2', request)).rejects.toMatchObject({
      code: 'DICE_ROLL_ID_REUSED',
    });
  });

  it('lists the history of an active game', async () => {
    const { service: dice } = service({ game: game('ACTIVE') });
    await expect(dice.list('game-1', 'player-1', 20)).resolves.toEqual([stored]);
  });

  it.each(['LOBBY', 'FINISHED'] as const)('shows no history in a %s game', async (status) => {
    const { service: dice } = service({ game: game(status) });
    await expect(dice.list('game-1', 'player-1', 20)).resolves.toEqual([]);
  });
});
