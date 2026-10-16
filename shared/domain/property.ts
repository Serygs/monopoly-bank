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
