import type { BoardSnapshot, PropertyTile } from '../board/types.js';
import type { GameProperty, PropertyChange, PropertyState } from '../types/monopoly.js';
import { AppError } from '../../worker/services/errors.js';

/** The board a game plays on and the registry rows the operation read. */
export interface PropertyContext {
  board: BoardSnapshot;
  registry: readonly GameProperty[];
}

export class TileNotFoundError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'TILE_NOT_FOUND',
      message: 'This tile is not on the board.',
      status: 404,
      details: { tileId },
    });
  }
}

export class PropertyAlreadyOwnedError extends AppError {
  constructor(tileId: string, ownerPlayerId: string | null) {
    super({
      code: 'PROPERTY_ALREADY_OWNED',
      message: 'This property already has an owner.',
      status: 409,
      details: { tileId, ownerPlayerId },
    });
  }
}

export class PropertyNotOwnedError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_NOT_OWNED',
      message: 'The player does not own this property.',
      status: 409,
      details: { tileId },
    });
  }
}

export class PropertyMortgagedError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_MORTGAGED',
      message: 'This property is mortgaged.',
      status: 409,
      details: { tileId },
    });
  }
}

export class PropertyHasBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'PROPERTY_HAS_BUILDINGS',
      message: 'This property or its colour group has buildings.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Houses and hotels go on streets only. */
export class TileNotBuildableError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'TILE_NOT_BUILDABLE',
      message: 'Only streets can have houses or hotels.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Building needs the whole colour group. */
export class BuildRequiresFullGroupError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_REQUIRES_FULL_GROUP',
      message: 'The player must hold the whole colour group to build.',
      status: 409,
      details: { tileId },
    });
  }
}

/** Buildings are added and sold evenly across a colour group. */
export class BuildUnevenError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_UNEVEN',
      message: 'Buildings must be spread evenly across the colour group.',
      status: 409,
      details: { tileId },
    });
  }
}

export class BuildMortgagedGroupError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'BUILD_MORTGAGED_GROUP',
      message: 'A tile of this colour group is mortgaged.',
      status: 409,
      details: { tileId },
    });
  }
}

export class NoBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'NO_BUILDINGS',
      message: 'This property has no buildings to sell.',
      status: 409,
      details: { tileId },
    });
  }
}

export class MaxBuildingsError extends AppError {
  constructor(tileId: string) {
    super({
      code: 'MAX_BUILDINGS',
      message: 'This property already has a hotel.',
      status: 409,
      details: { tileId },
    });
  }
}

/** A utility rent needs the dice sum; any other tile must not carry one. */
export class DiceSumError extends AppError {
  constructor(required: boolean) {
    super({
      code: 'VALIDATION_ERROR',
      message: required
        ? 'diceSum is required to pay the rent of a utility.'
        : 'diceSum applies to utilities only.',
      status: 400,
      details: { field: 'diceSum' },
    });
  }
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

/**
 * The rent for landing on a tile, worked out from the registry:
 * - street: the rent row for its houses (5 = hotel); base rent is doubled when the owner holds the
 *   whole colour group and no tile of it has buildings;
 * - railway: by the number of railways the owner holds;
 * - utility: the dice multiplier for the number of utilities held times `diceSum`.
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
  return multiplier * diceSum;
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
