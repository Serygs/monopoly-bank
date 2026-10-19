import type { DiceRoll } from '../../shared/contracts/api.js';
import {
  D1DiceRollRepository,
  diceRollsKeptPerPlayer,
  type DiceRollRepository,
} from './dice-roll-repository.js';

export interface DiceRollStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
}

const PREFIX = 'dice:';

export class DurableObjectDiceRollRepository implements DiceRollRepository {
  private readonly storage: DiceRollStorage;
  private readonly database: D1Database;
  constructor(storage: DiceRollStorage, database: D1Database) {
    this.storage = storage;
    this.database = database;
  }

  async record(input: {
    id: string;
    gameId: string;
    playerId: string;
    dieOne: number;
    dieTwo: number;
  }): Promise<DiceRoll | null> {
    const rolls = await this.rolls(input.gameId, input.playerId);
    const existing = rolls.find((roll) => roll.id === input.id);
    if (existing !== undefined) return existing;
    if (await this.usedElsewhere(input.id)) return null;
    const roll: DiceRoll = {
      id: input.id,
      playerId: input.playerId,
      dieOne: input.dieOne,
      dieTwo: input.dieTwo,
      createdAt: new Date().toISOString(),
    };
    await this.storage.put(
      PREFIX + input.playerId,
      [roll, ...rolls].slice(0, diceRollsKeptPerPlayer),
    );
    return roll;
  }

  async clear(): Promise<void> {
    const keys = [...(await this.storage.list<DiceRoll[]>({ prefix: PREFIX })).keys()];
    if (keys.length > 0) await this.storage.delete(keys);
  }

  async listForPlayer(gameId: string, playerId: string, limit: number): Promise<DiceRoll[]> {
    return (await this.rolls(gameId, playerId)).slice(0, limit);
  }

  private async rolls(gameId: string, playerId: string): Promise<DiceRoll[]> {
    return (
      (await this.storage.get<DiceRoll[]>(PREFIX + playerId)) ??
      (await new D1DiceRollRepository(this.database).listForPlayer(
        gameId,
        playerId,
        diceRollsKeptPerPlayer,
      ))
    );
  }

  private async usedElsewhere(id: string): Promise<boolean> {
    for (const rolls of (await this.storage.list<DiceRoll[]>({ prefix: PREFIX })).values())
      if (rolls.some((roll) => roll.id === id)) return true;
    const legacy = await this.database
      .prepare('SELECT 1 AS used FROM dice_rolls WHERE id = ?')
      .bind(id)
      .first<{ used: number }>();
    return legacy !== null;
  }
}
