import { describe, expect, it } from 'vitest';

import { D1GameAccessRepository } from './game-access-repository.js';

describe('D1GameAccessRepository controller access', () => {
  it('reads only the actor controls in primary/local order', async () => {
    const database = new ControllerDatabase([{ player_id: 'primary', controller_kind: 'PRIMARY' }, { player_id: 'local', controller_kind: 'LOCAL' }]);
    const repository = new D1GameAccessRepository(database as unknown as D1Database);

    await expect(repository.listPlayerControllers('game', 'actor')).resolves.toEqual([{ playerId: 'primary', kind: 'PRIMARY' }, { playerId: 'local', kind: 'LOCAL' }]);
    expect(database.bindings).toContainEqual(['game', 'actor']);
  });

  it('checks controller ownership using game, actor, and wallet identifiers', async () => {
    const database = new ControllerDatabase([]);
    database.firstResult = { value: 1 };
    const repository = new D1GameAccessRepository(database as unknown as D1Database);

    await expect(repository.isPlayerControlledBy('game', 'actor', 'wallet')).resolves.toBe(true);
    expect(database.bindings).toContainEqual(['game', 'actor', 'wallet']);
  });
});

class ControllerDatabase {
  readonly bindings: unknown[][] = [];
  firstResult: { value: number } | null = null;
  constructor(private readonly rows: Array<{ player_id: string; controller_kind: 'PRIMARY' | 'LOCAL' }>) {}
  prepare(): { bind: (...values: unknown[]) => { all: () => Promise<{ results: Array<{ player_id: string; controller_kind: 'PRIMARY' | 'LOCAL' }> }>; first: <T>() => Promise<T | null> } } {
    return { bind: (...values) => { this.bindings.push(values); return { all: async () => ({ results: this.rows }), first: async <T>() => this.firstResult as T | null }; } };
  }
}
