import { describe, expect, it } from 'vitest';
import { declareBankruptcy } from '../../shared/domain/banking.js';
import type { Game, Player } from '../../shared/types/monopoly.js';

const game: Game = { id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'K', status: 'ACTIVE', createdAt: '', updatedAt: '' };
const players: Player[] = [{ id: 'a', gameId: 'game', name: 'Ada', color: '#000', balance: 400, status: 'ACTIVE', createdAt: '' }, { id: 'b', gameId: 'game', name: 'Lin', color: '#111', balance: 700, status: 'ACTIVE', createdAt: '' }];
describe('bankruptcy operation', () => {
  it('transfers the complete remaining balance to a player creditor', () => expect(declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'b' }).affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0], ['b', 1100]]));
  it('transfers no balance to a player when bankruptcy is to bank', () => expect(declareBankruptcy({ game, players, playerId: 'a' }).affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0]]));
});
