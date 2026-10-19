import type { BoardSnapshot, PropertyGroupId, PropertyTile } from '../board/types.js';
import type { AppError } from '../../worker/services/errors.js';
import type { GameProperty, PropertyChange, PropertyState } from '../types/monopoly.js';
import {
  BuildMortgagedGroupError,
  BuildRequiresFullGroupError,
  BuildUnevenError,
  DiceSumError,
  InvalidBuildTargetError,
  MaxBuildingsError,
  NoBuildingsError,
  PropertyHasBuildingsError,
  PropertyMortgagedError,
  PropertyNotOwnedError,
  TileNotBuildableError,
  TileNotFoundError,
} from './property-errors.js';

export * from './property-errors.js';

/** The board a game plays on and the registry rows the operation read. */
export interface PropertyContext {
  board: BoardSnapshot;
  registry: readonly GameProperty[];
}

const unowned: PropertyState = { ownerPlayerId: null, mortgaged: false, houses: 0 };

export function requireTile(board: BoardSnapshot, tileId: string): PropertyTile {
  const tile = board.tiles.find((candidate) => candidate.id === tileId);
  if (tile === undefined) throw new TileNotFoundError(tileId);
  return tile;
}

export function groupTiles(board: BoardSnapshot, tile: PropertyTile): PropertyTile[] {
  return board.tiles.filter((candidate) => candidate.group === tile.group);
}

/** The registry state of a tile; a tile with no row is treated as unowned. */
export function stateOf(registry: readonly GameProperty[], tileId: string): PropertyState {
  const row = registry.find((candidate) => candidate.tileId === tileId);
  return row === undefined
    ? unowned
    : { ownerPlayerId: row.ownerPlayerId, mortgaged: row.mortgaged, houses: row.houses };
}

function ownedCount(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tile: PropertyTile,
  ownerPlayerId: string,
): number {
  return groupTiles(board, tile).filter(
    (candidate) => stateOf(registry, candidate.id).ownerPlayerId === ownerPlayerId,
  ).length;
}

/** Whether `ownerPlayerId` holds every tile of the tile's colour group. */
export function holdsFullGroup(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tile: PropertyTile,
  ownerPlayerId: string,
): boolean {
  return ownedCount(board, registry, tile, ownerPlayerId) === groupTiles(board, tile).length;
}

/** Whether any tile of the tile's group has houses or a hotel. */
export function groupHasBuildings(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tile: PropertyTile,
): boolean {
  return groupTiles(board, tile).some((candidate) => stateOf(registry, candidate.id).houses > 0);
}

/** The owner holds the tile, it is not mortgaged and neither it nor its group has buildings. */
export function canMortgage(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tileId: string,
  playerId: string,
): boolean {
  const tile = board.tiles.find((candidate) => candidate.id === tileId);
  if (tile === undefined) return false;
  const state = stateOf(registry, tileId);
  return (
    state.ownerPlayerId === playerId &&
    !state.mortgaged &&
    state.houses === 0 &&
    !groupHasBuildings(board, registry, tile)
  );
}

/** Throws the specific reason a tile cannot be mortgaged by the player. */
export function assertCanMortgage(
  context: PropertyContext,
  tileId: string,
  playerId: string,
): void {
  const tile = requireTile(context.board, tileId);
  const state = stateOf(context.registry, tileId);
  if (state.ownerPlayerId !== playerId) throw new PropertyNotOwnedError(tileId);
  if (state.mortgaged) throw new PropertyMortgagedError(tileId);
  if (state.houses > 0 || groupHasBuildings(context.board, context.registry, tile))
    throw new PropertyHasBuildingsError(tileId);
}

/** The most buildings a street carries: four houses, then a hotel counted as the fifth. */
export const MAX_BUILDINGS = 5;

/** The reason `playerId` cannot add a building to the tile, or `null` when they can. */
function buildBlocker(context: PropertyContext, tileId: string, playerId: string): AppError | null {
  const { board, registry } = context;
  const tile = requireTile(board, tileId);
  if (tile.type !== 'street' || tile.houseCost === undefined)
    return new TileNotBuildableError(tileId);
  const state = stateOf(registry, tileId);
  if (state.ownerPlayerId !== playerId) return new PropertyNotOwnedError(tileId);
  if (!holdsFullGroup(board, registry, tile, playerId))
    return new BuildRequiresFullGroupError(tileId);
  const group = groupTiles(board, tile).map((candidate) => stateOf(registry, candidate.id));
  if (group.some((candidate) => candidate.mortgaged)) return new BuildMortgagedGroupError(tileId);
  if (state.houses >= MAX_BUILDINGS) return new MaxBuildingsError(tileId);
  if (board.rules.buildEvenly && state.houses > Math.min(...group.map((item) => item.houses)))
    return new BuildUnevenError(tileId);
  return null;
}

/** The reason `playerId` cannot sell a building on the tile, or `null` when they can. */
function sellBlocker(context: PropertyContext, tileId: string, playerId: string): AppError | null {
  const { board, registry } = context;
  const tile = requireTile(board, tileId);
  if (tile.type !== 'street' || tile.houseCost === undefined)
    return new TileNotBuildableError(tileId);
  const state = stateOf(registry, tileId);
  if (state.ownerPlayerId !== playerId) return new PropertyNotOwnedError(tileId);
  if (state.houses === 0) return new NoBuildingsError(tileId);
  const group = groupTiles(board, tile).map((candidate) => stateOf(registry, candidate.id));
  if (board.rules.buildEvenly && state.houses < Math.max(...group.map((item) => item.houses)))
    return new BuildUnevenError(tileId);
  return null;
}

/** Whether the player may build on the tile now (full group, none mortgaged, evenly, below a hotel). */
export function canBuild(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tileId: string,
  playerId: string,
): boolean {
  if (!board.tiles.some((tile) => tile.id === tileId)) return false;
  return buildBlocker({ board, registry }, tileId, playerId) === null;
}

/** Whether the player may sell a building on the tile now (owner, has buildings, evenly). */
export function canSellBuilding(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tileId: string,
  playerId: string,
): boolean {
  if (!board.tiles.some((tile) => tile.id === tileId)) return false;
  return sellBlocker({ board, registry }, tileId, playerId) === null;
}

/** Throws the specific reason the player cannot build on the tile. */
export function assertCanBuild(context: PropertyContext, tileId: string, playerId: string): void {
  const blocker = buildBlocker(context, tileId, playerId);
  if (blocker !== null) throw blocker;
}

/** Throws the specific reason the player cannot sell a building on the tile. */
export function assertCanSellBuilding(
  context: PropertyContext,
  tileId: string,
  playerId: string,
): void {
  const blocker = sellBlocker(context, tileId, playerId);
  if (blocker !== null) throw blocker;
}

export interface BuildingPlan {
  /** The registry changes, one per street whose level changes (board order). */
  changes: PropertyChange[];
  /** How many buildings are added (build) or sold (sell) across all streets. */
  buildings: number;
}

/**
 * Plans raising (`BUILD`) or lowering (`SELL`) the buildings of one colour group to the levels in
 * `targets` (tile id -> 0..5, a hotel is 5). The FINAL state is what is validated: the player owns
 * the whole group, no tile of it is mortgaged, every target moves in the requested direction, at
 * least one changes, and with even building the levels end at most one apart. Streets left out of
 * `targets` keep their level. The caller prices it and checks the cash.
 */
export function planBuildings(
  context: PropertyContext,
  playerId: string,
  targets: Readonly<Record<string, number>>,
  direction: 'BUILD' | 'SELL',
): BuildingPlan {
  const { board, registry } = context;
  const entries = Object.entries(targets);
  if (entries.length === 0) throw new InvalidBuildTargetError('no street named');
  const first = requireTile(board, entries[0]![0]);
  const group = groupTiles(board, first);
  for (const [tileId, level] of entries) {
    const tile = requireTile(board, tileId);
    if (tile.type !== 'street' || tile.houseCost === undefined)
      throw new TileNotBuildableError(tileId);
    if (tile.group !== first.group)
      throw new InvalidBuildTargetError('one colour group only', tileId);
    if (!Number.isInteger(level) || level < 0 || level > MAX_BUILDINGS)
      throw new InvalidBuildTargetError('a level is 0 to 5', tileId);
    if (stateOf(registry, tileId).ownerPlayerId !== playerId)
      throw new PropertyNotOwnedError(tileId);
  }
  if (!holdsFullGroup(board, registry, first, playerId))
    throw new BuildRequiresFullGroupError(first.id);
  if (group.some((tile) => stateOf(registry, tile.id).mortgaged))
    throw new BuildMortgagedGroupError(first.id);

  const changes: PropertyChange[] = [];
  let buildings = 0;
  const finalLevels: number[] = [];
  for (const tile of group) {
    const state = stateOf(registry, tile.id);
    const level = targets[tile.id] ?? state.houses;
    finalLevels.push(level);
    if (level === state.houses) continue;
    if (direction === 'BUILD' ? level < state.houses : level > state.houses)
      throw new InvalidBuildTargetError(
        direction === 'BUILD' ? 'a build cannot remove buildings' : 'a sale cannot add buildings',
        tile.id,
      );
    buildings += Math.abs(level - state.houses);
    changes.push(buildingChange(tile.id, state, level));
  }
  if (changes.length === 0) throw new InvalidBuildTargetError('nothing changes');
  if (board.rules.buildEvenly && Math.max(...finalLevels) - Math.min(...finalLevels) > 1)
    throw new BuildUnevenError(changes[0]!.tileId);
  return { changes, buildings };
}

/** What one house (or the hotel, as the fifth building) costs, from the snapshot. */
export function buildCost(board: BoardSnapshot, tileId: string): number {
  return requireTile(board, tileId).houseCost ?? 0;
}

/** What the bank pays back for selling one building: half the house cost, rounded down. */
export function sellRefund(board: BoardSnapshot, tileId: string): number {
  return Math.floor(buildCost(board, tileId) * board.rules.sellBuildingRefund);
}

/** The change that sets a tile's buildings to `houses`. */
export function buildingChange(
  tileId: string,
  before: PropertyState,
  houses: number,
): PropertyChange {
  return { tileId, before, after: { ...before, houses } };
}

/** What a player pays the bank for an unowned tile (the snapshot price, never the preset's). */
export function purchasePrice(board: BoardSnapshot, tileId: string): number {
  return requireTile(board, tileId).price;
}

/** What one point of a utility's dice-times-multiplier rent is worth: the card reads 4 or 10 times the dice, in thousands. */
export const UTILITY_RENT_UNIT = 1000;

/**
 * The rent for landing on a tile, worked out from the registry:
 * - street: the rent row for its houses (5 = hotel); base rent is doubled when the owner holds the
 *   whole colour group and no tile of it has buildings;
 * - railway: by the number of railways the owner holds;
 * - utility: the dice multiplier for the number of utilities held times `diceSum` times
 *   `UTILITY_RENT_UNIT`.
 * An unowned or mortgaged tile earns nothing and is refused.
 */
export function rentFor(
  board: BoardSnapshot,
  registry: readonly GameProperty[],
  tileId: string,
  diceSum?: number,
): number {
  const tile = requireTile(board, tileId);
  const state = stateOf(registry, tileId);
  const owner = state.ownerPlayerId;
  if (owner === null) throw new PropertyNotOwnedError(tileId);
  if (state.mortgaged) throw new PropertyMortgagedError(tileId);
  if (tile.type === 'street') {
    if (diceSum !== undefined) throw new DiceSumError(false);
    const rent = tile.rent;
    if (rent === undefined) throw new TileNotFoundError(tileId);
    if (state.houses === 0) {
      const doubled =
        holdsFullGroup(board, registry, tile, owner) && !groupHasBuildings(board, registry, tile);
      return doubled ? rent[0] * board.rules.monopolyBaseRentMultiplier : rent[0];
    }
    return rent[Math.min(state.houses, 5)] as number;
  }
  const count = ownedCount(board, registry, tile, owner);
  if (tile.type === 'railway') {
    if (diceSum !== undefined) throw new DiceSumError(false);
    const rent = board.rules.railwayRent[String(count)];
    if (rent === undefined) throw new TileNotFoundError(tileId);
    return rent;
  }
  if (diceSum === undefined) throw new DiceSumError(true);
  const multiplier = board.rules.utilityDiceMultiplier[String(count)];
  if (multiplier === undefined) throw new TileNotFoundError(tileId);
  return multiplier * diceSum * UTILITY_RENT_UNIT;
}

/** The change that gives an unowned tile to a player. */
export function ownerChange(
  tileId: string,
  before: PropertyState,
  ownerPlayerId: string | null,
): PropertyChange {
  return {
    tileId,
    before,
    after: {
      ownerPlayerId,
      // A tile handed back to the bank is released from its mortgage.
      mortgaged: ownerPlayerId === null ? false : before.mortgaged,
      houses: ownerPlayerId === null ? 0 : before.houses,
    },
  };
}

export function mortgageChange(
  tileId: string,
  before: PropertyState,
  mortgaged: boolean,
): PropertyChange {
  return { tileId, before, after: { ...before, mortgaged } };
}

/** The changes that move every effect of `changes` back (before and after swapped). */
export function invertChanges(changes: readonly PropertyChange[]): PropertyChange[] {
  return changes.map((change) => ({
    tileId: change.tileId,
    before: change.after,
    after: change.before,
  }));
}

/** The registry after `changes`, for callers that need to preview it. */
export function applyChanges(
  registry: readonly GameProperty[],
  changes: readonly PropertyChange[],
): GameProperty[] {
  return registry.map((row) => {
    const change = changes.find((candidate) => candidate.tileId === row.tileId);
    return change === undefined
      ? row
      : {
          ...row,
          ownerPlayerId: change.after.ownerPlayerId,
          mortgaged: change.after.mortgaged,
          houses: change.after.houses,
        };
  });
}

/** Anything with a tile and an owner that a picker can list. */
export interface PickerTileLike {
  tile: PropertyTile;
  ownerPlayerId: string | null;
}

export interface PickerGroup<T extends PickerTileLike> {
  group: PropertyGroupId;
  items: T[];
}

export interface PickerSection<T extends PickerTileLike> {
  /** Free tiles come first, owned ones last. */
  kind: 'free' | 'owned';
  groups: PickerGroup<T>[];
}

/**
 * The order of every tile picker: free tiles first, owned ones last; inside each, colour groups
 * from the cheapest to the dearest (by their cheapest tile, ties by board position), and inside a
 * group by ascending price (ties by board position). Empty sections are left out. Pure: the input
 * is not modified.
 */
export function orderTilesForPicker<T extends PickerTileLike>(
  items: readonly T[],
): PickerSection<T>[] {
  const byPrice = (a: T, b: T) => a.tile.price - b.tile.price || a.tile.pos - b.tile.pos;
  const section = (kind: 'free' | 'owned', list: readonly T[]): PickerSection<T> => {
    const groups = new Map<PropertyGroupId, T[]>();
    for (const item of [...list].sort(byPrice)) {
      const inGroup = groups.get(item.tile.group);
      if (inGroup === undefined) groups.set(item.tile.group, [item]);
      else inGroup.push(item);
    }
    // Insertion order is already by each group's cheapest tile, because the list is price-sorted.
    return { kind, groups: [...groups].map(([group, grouped]) => ({ group, items: grouped })) };
  };
  return [
    section(
      'free',
      items.filter((item) => item.ownerPlayerId === null),
    ),
    section(
      'owned',
      items.filter((item) => item.ownerPlayerId !== null),
    ),
  ].filter((entry) => entry.groups.length > 0);
}

/**
 * Which streets of the colour group of `tileId` caused a `planBuildings` error `code`, so the UI
 * can mark them (display only; validation is unchanged). `finalLevels` is the wanted level per
 * street (tile id -> level; a missing street keeps its registry level). A mortgaged group points at
 * the mortgaged streets, an uneven plan at the streets that run too far ahead (build) or fall too
 * far behind (sell); any other code names no particular street.
 */
export function offendingStreets(
  context: PropertyContext,
  tileId: string,
  code: string,
  finalLevels: Readonly<Record<string, number>>,
  direction: 'BUILD' | 'SELL',
): string[] {
  const { board, registry } = context;
  const group = groupTiles(board, requireTile(board, tileId));
  if (code === 'BUILD_MORTGAGED_GROUP')
    return group.filter((tile) => stateOf(registry, tile.id).mortgaged).map((tile) => tile.id);
  if (code !== 'BUILD_UNEVEN') return [];
  const levels = group.map((tile) => ({
    id: tile.id,
    level: finalLevels[tile.id] ?? stateOf(registry, tile.id).houses,
  }));
  const min = Math.min(...levels.map((item) => item.level));
  const max = Math.max(...levels.map((item) => item.level));
  return levels
    .filter((item) => (direction === 'BUILD' ? item.level > min + 1 : item.level < max - 1))
    .map((item) => item.id);
}
