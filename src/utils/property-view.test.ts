/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api';
import { netWorthRanking } from '../../shared/domain/net-worth';
import { calculateRent } from '../../shared/domain/property';
import type { BoardDefinition, BoardSpace, Game, GameProperty, Player } from '../../shared/types/monopoly';
import { buildableCounts, contrastRatio, freeSpaces, groupSpaces, hasBoard, mergeProperties, playerNetWorth, propertyCommand, rentFor, spaceActions, spacesOwnedBy, type BoardState } from './property-view';

const board: BoardDefinition = { id: 'board-classic', name: 'Classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 };
const street = (id: string, boardIndex: number, colorGroup: BoardSpace['colorGroup'], price: number, houseCost: number, rents: number[]): BoardSpace => ({ id, boardIndex, kind: 'STREET', colorGroup, translationKey: `boardSpace${id}`, customName: null, price, mortgageValue: price / 2, houseCost, rents });
const spaces: BoardSpace[] = [
  street('Mediterranean', 1, 'BROWN', 60, 50, [2, 10, 30, 90, 160, 250]),
  street('Baltic', 3, 'BROWN', 60, 50, [4, 20, 60, 180, 320, 450]),
  { id: 'Reading', boardIndex: 5, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: 'boardSpaceReadingRailroad', customName: null, price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] },
  { id: 'Electric', boardIndex: 12, kind: 'UTILITY', colorGroup: 'UTILITY', translationKey: 'boardSpaceElectricCompany', customName: null, price: 150, mortgageValue: 75, houseCost: null, rents: [] },
  street('Boardwalk', 39, 'DARK_BLUE', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];
const game: Game = { id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '', updatedAt: '', boardId: board.id };
const ada: Player = { id: 'ada', gameId: 'game', name: 'Ada', color: '#111', balance: 1500, status: 'ACTIVE', lastRollTotal: 7, createdAt: '' };
const bob: Player = { id: 'bob', gameId: 'game', name: 'Bob', color: '#222', balance: 40, status: 'ACTIVE', createdAt: '' };
const players = [ada, bob];

function stateWith(properties: GameProperty[], buildingBank = { housesAvailable: 32, hotelsAvailable: 12 }): BoardState {
  return { board, boardSpaces: spaces, properties, buildingBank };
}

describe('hasBoard', () => {
  const details: GameDetails = { game, players };
  it('is false for a game that never chose a board, whatever else the details carry', () => {
    expect(hasBoard(details)).toBe(false);
    expect(hasBoard({ ...details, board })).toBe(false);
    expect(hasBoard({ ...details, board, boardSpaces: spaces, properties: [] })).toBe(false);
  });
  it('is true only when all four board fields travel together', () => {
    expect(hasBoard({ ...details, ...stateWith([]) })).toBe(true);
  });
});

describe('grouping and ownership', () => {
  it('groups spaces in canonical colour order with railroads and utilities last', () => {
    expect(groupSpaces(spaces).map((entry) => entry.group)).toEqual(['BROWN', 'DARK_BLUE', 'RAILROAD', 'UTILITY']);
    expect(groupSpaces(spaces)[0].spaces.map((space) => space.id)).toEqual(['Mediterranean', 'Baltic']);
  });
  it('splits owned and free spaces from the deed rows, treating a missing row as free', () => {
    const state = stateWith([{ boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 0, mortgaged: false }]);
    expect(spacesOwnedBy(state, 'ada').map((space) => space.id)).toEqual(['Baltic']);
    expect(freeSpaces(state).map((space) => space.id)).toEqual(['Mediterranean', 'Reading', 'Electric', 'Boardwalk']);
  });
  it('merges changed deed rows by space id and keeps the rest', () => {
    const current: GameProperty[] = [{ boardSpaceId: 'Baltic', ownerPlayerId: null, houses: 0, mortgaged: false }, { boardSpaceId: 'Reading', ownerPlayerId: 'bob', houses: 0, mortgaged: false }];
    const merged = mergeProperties(current, [{ boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 0, mortgaged: false }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((property) => property.boardSpaceId === 'Baltic')?.ownerPlayerId).toBe('ada');
    expect(merged.find((property) => property.boardSpaceId === 'Reading')?.ownerPlayerId).toBe('bob');
  });
});

describe('net worth', () => {
  it('equals the domain ranking for the same snapshot', () => {
    const state = stateWith([
      { boardSpaceId: 'Boardwalk', ownerPlayerId: 'ada', houses: 2, mortgaged: false },
      { boardSpaceId: 'Reading', ownerPlayerId: 'ada', houses: 0, mortgaged: true },
    ]);
    const ranking = netWorthRanking(players, state.boardSpaces, state.properties);
    expect(playerNetWorth(ada, state)).toBe(1500 + 400 + 2 * 200 + 100);
    expect(playerNetWorth(ada, state)).toBe(ranking.find((entry) => entry.player.id === 'ada')?.netWorth);
    expect(playerNetWorth(bob, state)).toBe(ranking.find((entry) => entry.player.id === 'bob')?.netWorth);
  });
});

describe('space actions', () => {
  it('offers purchase at the catalogue price and an auction for a free deed', () => {
    const actions = spaceActions({ game, players, state: stateWith([]), actor: ada }, spaces[0]);
    expect(actions).toEqual([
      { kind: 'PURCHASE', amount: 60, enabled: true, reason: null },
      { kind: 'AUCTION', amount: null, enabled: true, reason: null },
    ]);
  });
  it('disables purchase with the domain reason when the wallet cannot pay', () => {
    const [purchase] = spaceActions({ game, players, state: stateWith([]), actor: bob }, spaces[4]);
    expect(purchase).toMatchObject({ kind: 'PURCHASE', amount: 400, enabled: false, reason: 'insufficientFunds' });
  });
  it('prices rent on someone else’s deed with calculateRent and blocks it when mortgaged', () => {
    const owned = stateWith([{ boardSpaceId: 'Mediterranean', ownerPlayerId: 'bob', houses: 0, mortgaged: false }, { boardSpaceId: 'Baltic', ownerPlayerId: 'bob', houses: 0, mortgaged: false }]);
    const [rent] = spaceActions({ game, players, state: owned, actor: ada }, spaces[1]);
    expect(rent).toEqual({ kind: 'PAY_RENT', amount: calculateRent({ ...propertyCommand({ game, players, state: owned }), boardSpaceId: 'Baltic' }), enabled: true, reason: null });
    expect(rent.amount).toBe(8);
    const mortgaged = stateWith([{ boardSpaceId: 'Baltic', ownerPlayerId: 'bob', houses: 0, mortgaged: true }]);
    expect(spaceActions({ game, players, state: mortgaged, actor: ada }, spaces[1])).toEqual([{ kind: 'PAY_RENT', amount: null, enabled: false, reason: 'reasonMortgaged' }]);
  });
  it('uses the payer’s last roll for a utility and leaves it open when there is none', () => {
    const owned = stateWith([{ boardSpaceId: 'Electric', ownerPlayerId: 'bob', houses: 0, mortgaged: false }]);
    expect(spaceActions({ game, players, state: owned, actor: ada }, spaces[3])[0].amount).toBe(7 * 4);
    expect(rentFor({ game, players, state: owned }, spaces[3])).toBeNull();
    expect(rentFor({ game, players, state: owned }, spaces[3], 12)).toBe(48);
  });
  it('explains why the owner cannot build or mortgage, and prices what they can', () => {
    const halfGroup = stateWith([{ boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 0, mortgaged: false }]);
    const actions = spaceActions({ game, players, state: halfGroup, actor: ada }, spaces[1]);
    expect(actions.map((action) => action.kind)).toEqual(['CHARGE_RENT', 'BUILD', 'SELL_BUILDINGS', 'MORTGAGE']);
    expect(actions[0]).toMatchObject({ amount: 4, enabled: true });
    expect(actions[1]).toMatchObject({ amount: 50, enabled: false, reason: 'errorIncompleteColorGroup', reasonValues: { group: 'BROWN' } });
    expect(actions[2]).toMatchObject({ enabled: false, reason: 'reasonNoBuildings' });
    expect(actions[3]).toMatchObject({ amount: 30, enabled: true });

    const built = stateWith([{ boardSpaceId: 'Mediterranean', ownerPlayerId: 'ada', houses: 1, mortgaged: false }, { boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 0, mortgaged: false }]);
    const builtActions = spaceActions({ game, players, state: built, actor: ada }, spaces[0]);
    expect(builtActions.find((action) => action.kind === 'BUILD')).toMatchObject({ enabled: false, reason: 'errorUnevenBuilding' });
    expect(builtActions.find((action) => action.kind === 'SELL_BUILDINGS')).toMatchObject({ amount: 25, enabled: true });
    expect(builtActions.find((action) => action.kind === 'MORTGAGE')).toMatchObject({ enabled: false, reason: 'errorBuildingsPresent' });
  });
  it('prices redemption with the board interest and offers no rent on a mortgaged own deed', () => {
    const mortgaged = stateWith([{ boardSpaceId: 'Reading', ownerPlayerId: 'ada', houses: 0, mortgaged: true }]);
    const actions = spaceActions({ game, players, state: mortgaged, actor: ada }, spaces[2]);
    expect(actions).toEqual([
      { kind: 'CHARGE_RENT', amount: null, enabled: false, reason: 'reasonMortgaged' },
      { kind: 'UNMORTGAGE', amount: 110, enabled: true, reason: null },
    ]);
  });
  it('lists the building counts the domain accepts', () => {
    const group = stateWith([{ boardSpaceId: 'Mediterranean', ownerPlayerId: 'ada', houses: 0, mortgaged: false }, { boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 0, mortgaged: false }]);
    expect(buildableCounts({ game, players, state: group, actor: ada }, spaces[0], 'BUILD')).toEqual([1]);
    const hotel = stateWith([{ boardSpaceId: 'Mediterranean', ownerPlayerId: 'ada', houses: 5, mortgaged: false }, { boardSpaceId: 'Baltic', ownerPlayerId: 'ada', houses: 4, mortgaged: false }]);
    // Selling must stay even: the hotel may drop to four or three houses next to a four-house neighbour, the neighbour cannot drop below three.
    expect(buildableCounts({ game, players, state: hotel, actor: ada }, spaces[0], 'SELL')).toEqual([1, 2]);
    expect(buildableCounts({ game, players, state: hotel, actor: ada }, spaces[1], 'SELL')).toEqual([]);
  });
  it('offers nothing to a spectator', () => {
    expect(spaceActions({ game, players, state: stateWith([]), actor: null }, spaces[0])).toEqual([]);
  });
});

describe('colour group tokens', () => {
  // vitest stubs `.css` imports (even `?raw`), so the stylesheet is read from disk.
  const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const tokenNames = ['brown', 'light-blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark-blue', 'railroad', 'utility'];
  const themeBlock = (selector: string) => {
    const start = indexCss.indexOf(selector);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return indexCss.slice(start, indexCss.indexOf('}', start));
  };
  const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--group-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]));

  it.each([[':root {'], ["[data-theme='dark'] {"]])('defines the ten group tokens and a label colour with ≥ 4.5:1 contrast in %s', (selector) => {
    const themeTokens = tokens(themeBlock(selector));
    expect(themeTokens['label-text']).toBeDefined();
    for (const name of tokenNames) {
      expect(themeTokens[name], name).toBeDefined();
      expect(contrastRatio(themeTokens['label-text'], themeTokens[name]), `${selector} --group-${name} ${themeTokens[name]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes the WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
