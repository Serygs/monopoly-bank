import { describe, expect, it } from 'vitest';
import { declareBankruptcy } from '../../shared/domain/banking.js';
import type { BoardSpace, Game, GameProperty, Player } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';
import { ada, brownOne, gameId, lin, makeWorld, railroad } from './property-fixtures.test-support.js';

const game: Game = { id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'K', status: 'ACTIVE', createdAt: '', updatedAt: '' };
const players: Player[] = [{ id: 'a', gameId: 'game', name: 'Ada', color: '#000', balance: 400, status: 'ACTIVE', createdAt: '' }, { id: 'b', gameId: 'game', name: 'Lin', color: '#111', balance: 700, status: 'ACTIVE', createdAt: '' }];
describe('bankruptcy operation', () => {
  it('transfers the complete remaining balance to a player creditor', () => expect(declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'b' }).affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0], ['b', 1100]]));
  it('transfers no balance to a player when bankruptcy is to bank', () => expect(declareBankruptcy({ game, players, playerId: 'a' }).affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0]]));
});

// A game that never opted into a board passes no estate at all, which is what the
// two cases above cover. These add the board path on top of them, unchanged.
const spaces: BoardSpace[] = [
  { id: 'space-01', boardIndex: 1, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'space-01', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { id: 'space-05', boardIndex: 5, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: 'space-05', customName: null, price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] },
];
const properties: GameProperty[] = [
  { boardSpaceId: 'space-01', ownerPlayerId: 'a', houses: 2, mortgaged: false },
  { boardSpaceId: 'space-05', ownerPlayerId: 'a', houses: 0, mortgaged: true },
];

describe('bankruptcy operation with an estate', () => {
  it('adds the building proceeds to the creditor transfer and moves the deeds as they stand', () => {
    const result = declareBankruptcy({ game, players, playerId: 'a', creditorPlayerId: 'b', spaces, properties });

    expect(result.affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0], ['b', 1150]]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'space-01', ownerPlayerId: 'b', houses: 0, mortgaged: false },
      { boardSpaceId: 'space-05', ownerPlayerId: 'b', houses: 0, mortgaged: true },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 2, hotels: 0 });
  });

  it('frees the deeds for the table to auction when bankruptcy is to bank', () => {
    const result = declareBankruptcy({ game, players, playerId: 'a', spaces, properties });

    expect(result.affectedPlayers.map((item) => [item.player.id, item.balanceAfter])).toEqual([['a', 0]]);
    expect(result.propertyChanges.map((change) => change.ownerPlayerId)).toEqual([null, null]);
  });
});

describe('DefaultBankingService.declareBankruptcy on a board', () => {
  it('hands the whole estate to the domain, persists deeds and bank with the transfer, and answers with the fresh slice', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada, houses: 2 }, [railroad]: { ownerPlayerId: ada, mortgaged: true } }, buildingBank: { housesAvailable: 30, hotelsAvailable: 12 } });
    const service = new DefaultBankingService(world.dependencies as never);
    const response = await service.declareBankruptcy(gameId, { playerId: ada, creditorPlayerId: lin });

    expect(world.persist).toHaveBeenCalledTimes(1);
    const input = world.persist.mock.calls[0][0];
    expect(input.bankruptPlayerId).toBe(ada);
    expect(input.transaction.type).toBe('BANKRUPTCY_TRANSFER');
    expect(input.propertyChanges?.map((write) => write.change)).toEqual([
      { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false },
      { boardSpaceId: railroad, ownerPlayerId: lin, houses: 0, mortgaged: true },
    ]);
    expect(input.buildingBankDelta).toEqual({ houses: 2, hotels: 0 });
    expect(response.properties?.filter((deed) => deed.ownerPlayerId === lin).map((deed) => deed.boardSpaceId)).toEqual([brownOne, railroad]);
    expect(response.buildingBank).toEqual({ housesAvailable: 32, hotelsAvailable: 12 });
  });

  it('answers a board-less game without any board field and passes no estate', async () => {
    const world = makeWorld({ game: { boardId: null } });
    const response = await new DefaultBankingService(world.dependencies as never).declareBankruptcy(gameId, { playerId: ada });
    expect(world.persist.mock.calls[0][0]).not.toHaveProperty('propertyChanges');
    expect(response).not.toHaveProperty('properties');
    expect(response).not.toHaveProperty('buildingBank');
  });
});
