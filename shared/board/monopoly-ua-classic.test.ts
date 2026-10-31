import { describe, expect, it } from 'vitest';
import { declareBankruptcy, mortgageTransferFee, transferProperties } from '../domain/banking.js';
import { buildGameSettings } from '../domain/game-rules.js';
import { PropertyMortgagedError, rentFor, type PropertyContext } from '../domain/property.js';
import { defaultGameRules, type Game, type GameProperty, type Player } from '../types/monopoly.js';
import {
  boardDefaults,
  boardPresetModes,
  getBoardPreset,
  monopolyRu2012,
  monopolyUaClassic,
  type BoardPreset,
  type BoardSnapshot,
} from './index.js';

const presets: readonly BoardPreset[] = [monopolyRu2012, monopolyUaClassic];
const streetGroupSizes = {
  brown: 2,
  lightblue: 3,
  pink: 3,
  orange: 3,
  red: 3,
  yellow: 3,
  green: 3,
  blue: 2,
};

describe.each(presets)('preset $presetId', (preset) => {
  it('has 28 unique property tiles on valid, distinct positions', () => {
    expect(preset.tiles).toHaveLength(28);
    expect(new Set(preset.tiles.map((tile) => tile.id)).size).toBe(28);
    const positions = [
      ...preset.tiles.map((tile) => tile.pos),
      ...preset.nonPropertyTiles.map((tile) => tile.pos),
    ];
    expect(new Set(positions).size).toBe(40);
    expect(positions.every((pos) => Number.isInteger(pos) && pos >= 0 && pos <= 39)).toBe(true);
    for (const tile of preset.tiles) expect(tile.id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('declares group sizes that match the tiles; mortgage is half the price', () => {
    for (const [group, info] of Object.entries(preset.groups))
      expect(preset.tiles.filter((tile) => tile.group === group)).toHaveLength(info.size);
    for (const [group, size] of Object.entries(streetGroupSizes))
      expect(preset.groups[group as keyof typeof streetGroupSizes]?.size).toBe(size);
    expect(preset.groups.railway?.size).toBe(4);
    expect(preset.groups.utility?.size).toBe(2);
    for (const tile of preset.tiles) expect(tile.mortgage * 2).toBe(tile.price);
  });
});

describe('monopoly-ua-classic', () => {
  it('equals the RU preset divided by 10 at every position', () => {
    expect(monopolyUaClassic.baseStartBalance * 10).toBe(monopolyRu2012.baseStartBalance);
    for (const ru of monopolyRu2012.tiles) {
      const ua = monopolyUaClassic.tiles.find((tile) => tile.pos === ru.pos);
      expect(ua, `position ${ru.pos}`).toBeDefined();
      expect([ua?.type, ua?.group]).toEqual([ru.type, ru.group]);
      expect(ua!.price * 10).toBe(ru.price);
      expect(ua!.mortgage * 10).toBe(ru.mortgage);
      expect((ua!.houseCost ?? 0) * 10).toBe(ru.houseCost ?? 0);
      expect((ua!.rent ?? []).map((value) => value * 10)).toEqual(ru.rent ?? []);
    }
    expect(monopolyUaClassic.groups).toEqual(monopolyRu2012.groups);
    for (const key of Object.keys(monopolyRu2012.rules.railwayRent))
      expect(monopolyUaClassic.rules.railwayRent[key]! * 10).toBe(
        monopolyRu2012.rules.railwayRent[key],
      );
    expect(monopolyUaClassic.rules.utilityDiceMultiplier).toEqual(
      monopolyRu2012.rules.utilityDiceMultiplier,
    );
    expect(monopolyUaClassic.nonPropertyTiles.map((tile) => [tile.pos, tile.type])).toEqual(
      expect.arrayContaining(monopolyRu2012.nonPropertyTiles.map((tile) => [tile.pos, tile.type])),
    );
  });

  it('keeps the printed names and gives the transport tiles their icons', () => {
    const names = monopolyUaClassic.tiles.map((tile) => tile.name);
    expect(names).toContain('Дніпрогес');
    expect(names).toContain('Каховське водосховище');
    const transport = monopolyUaClassic.tiles.filter((tile) => tile.type === 'railway');
    expect(transport.map((tile) => tile.icon)).toEqual(['train', 'ship', 'train', 'plane']);
  });

  it('is offered after RU and brings its balance, GO reward and currency', () => {
    expect(boardPresetModes).toEqual(['monopoly-ru-2012', 'monopoly-ua-classic']);
    expect(boardDefaults('monopoly-ua-classic')).toEqual({
      startingBalance: 1_500_000,
      passGoReward: 200_000,
      currency: 'UAH',
    });
    expect(getBoardPreset('monopoly-ua-classic')).toBe(monopolyUaClassic);
  });
});

const settings = buildGameSettings(1_500_000, 'monopoly-ua-classic');
const board = settings.board as BoardSnapshot;
const game: Game = {
  id: 'game-ua',
  name: 'UA',
  startingBalance: 1_500_000,
  passGoReward: 200_000,
  currency: 'UAH',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const [p1, p2] = ['player-1', 'player-2'];

function registry(owned: Record<string, Partial<GameProperty>>): readonly GameProperty[] {
  return board.tiles.map((tile) => ({
    gameId: game.id,
    tileId: tile.id,
    ownerPlayerId: null,
    mortgaged: false,
    houses: 0,
    ...owned[tile.id],
  }));
}
const heldByP2 = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { ownerPlayerId: p2 }]));
const players = (balances: number[]): Player[] =>
  balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `c${index}`,
    balance,
    createdAt: '',
  }));
const property = (owned: Record<string, Partial<GameProperty>>): PropertyContext => ({
  board,
  registry: registry(owned),
});

describe('UA board at the preset scale', () => {
  it('is not rescaled at the 1.5M starting balance', () => {
    expect(board.multiplier).toBe(1);
    expect(board.tiles.map((tile) => tile.price)).toEqual(
      monopolyUaClassic.tiles.map((tile) => tile.price),
    );
    expect([board.incomeTax, board.luxuryTax, board.goReward]).toEqual([200_000, 100_000, 200_000]);
  });

  it('charges street rent by houses and doubles an unbuilt monopoly', () => {
    const rent = monopolyUaClassic.tiles.find((tile) => tile.id === 'yalta')!.rent!;
    for (let houses = 1; houses <= 5; houses += 1)
      expect(rentFor(board, registry({ yalta: { ownerPlayerId: p2, houses } }), 'yalta')).toBe(
        rent[houses],
      );
    expect(rentFor(board, registry(heldByP2('yalta')), 'yalta')).toBe(rent[0]);
    expect(rentFor(board, registry(heldByP2('yalta', 'sevastopol')), 'yalta')).toBe(rent[0] * 2);
  });

  it('charges transport rent by the number owned, whatever the tile names are', () => {
    const ids = ['simferopol_rail', 'odesa_port', 'kryvyi_rih_rail', 'boryspil'];
    [25_000, 50_000, 100_000, 200_000].forEach((expected, index) => {
      const owned = ids.slice(0, index + 1);
      for (const id of owned)
        expect(rentFor(board, registry(heldByP2(...owned)), id)).toBe(expected);
    });
  });

  it('charges utility rent as the multiplier times the dice in thousands', () => {
    expect(rentFor(board, registry(heldByP2('dniprohes')), 'dniprohes', 7)).toBe(28_000);
    expect(rentFor(board, registry(heldByP2('dniprohes', 'kakhovske')), 'kakhovske', 7)).toBe(
      70_000,
    );
  });

  it('refuses rent on a mortgaged tile', () => {
    expect(() =>
      rentFor(board, registry({ yalta: { ownerPlayerId: p2, mortgaged: true } }), 'yalta'),
    ).toThrow(PropertyMortgagedError);
  });

  it('charges 10% of the UA mortgage value when a mortgaged tile is traded', () => {
    expect(mortgageTransferFee(board, 'yalta')).toBe(3_000);
    const { transaction } = transferProperties({
      game,
      players: players([500_000, 500_000]),
      playerId: p1,
      counterpartyPlayerId: p2,
      giveTileIds: ['yalta'],
      takeTileIds: [],
      cashGive: 0,
      cashTake: 0,
      property: property({ yalta: { ownerPlayerId: p1, mortgaged: true } }),
    });
    expect(transaction.participants).toEqual(
      expect.arrayContaining([{ playerId: p2, balanceDelta: -3_000 }]),
    );
  });

  it('hands a bankrupt player’s tiles to the creditor, who pays the UA fee for a mortgaged one', () => {
    const result = declareBankruptcy({
      game,
      players: players([40_000, 100_000]),
      playerId: p1,
      creditorPlayerId: p2,
      property: property({
        klochkivska: { ownerPlayerId: p1, mortgaged: true },
        sumska: { ownerPlayerId: p1 },
      }),
    });
    const creditor = result.affectedPlayers.find((change) => change.player.id === p2)!;
    expect(creditor.balanceDelta).toBe(40_000 - 5_000);
    expect(result.transaction.registryChanges).toHaveLength(2);
  });
});
