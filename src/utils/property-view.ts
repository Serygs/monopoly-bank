import type { BoardSnapshot, PropertyGroupId, PropertyTile } from '../../shared/board';
import type { GameProperty } from '../../shared/types/monopoly';

/** Fixed swatch colours of the board's colour groups (domain data, like a player colour). */
export const propertyGroupColors: Record<PropertyGroupId, string> = {
  brown: '#8b5a2b',
  lightblue: '#7fc8e8',
  pink: '#d95f9b',
  orange: '#f08a24',
  red: '#d6322f',
  yellow: '#f2c91e',
  green: '#2e9b4f',
  blue: '#2750b8',
  railway: '#3a3f47',
  utility: '#8a94a3',
};

export type TileStatus = 'free' | 'owned' | 'mortgaged';

/** A catalog tile with its registry row (a missing row counts as a free tile). */
export interface TileView {
  tile: PropertyTile;
  ownerPlayerId: string | null;
  mortgaged: boolean;
  houses: number;
  status: TileStatus;
}

export interface GroupProgress {
  owned: number;
  size: number;
  /** The owner holds every tile of the group. */
  monopoly: boolean;
}

/** What the next rent payment on a tile would be; read-only, nothing here moves money. */
export type TileRent =
  | { kind: 'amount'; amount: number; level: number; monopolyDoubled: boolean }
  | { kind: 'dice'; multiplier: number; count: number }
  | { kind: 'none' };

export function tileViews(board: BoardSnapshot, properties: readonly GameProperty[]): TileView[] {
  const rows = new Map(properties.map((row) => [row.tileId, row]));
  return board.tiles.map((tile) => {
    const row = rows.get(tile.id);
    const ownerPlayerId = row?.ownerPlayerId ?? null;
    const mortgaged = row?.mortgaged ?? false;
    return {
      tile,
      ownerPlayerId,
      mortgaged,
      houses: row?.houses ?? 0,
      status: ownerPlayerId === null ? 'free' : mortgaged ? 'mortgaged' : 'owned',
    };
  });
}

/** How much of a group one owner holds. */
export function groupProgress(
  views: readonly TileView[],
  group: PropertyGroupId,
  ownerPlayerId: string,
): GroupProgress {
  const tiles = views.filter((view) => view.tile.group === group);
  const owned = tiles.filter((view) => view.ownerPlayerId === ownerPlayerId).length;
  return { owned, size: tiles.length, monopoly: tiles.length > 0 && owned === tiles.length };
}

/** The cards the given wallets hold, in board order. */
export function cardsOwnedBy(views: readonly TileView[], playerIds: readonly string[]): TileView[] {
  return views.filter(
    (view) => view.ownerPlayerId !== null && playerIds.includes(view.ownerPlayerId),
  );
}

/** Total list price of the cards. */
export function cardsValue(views: readonly TileView[]): number {
  return views.reduce((sum, view) => sum + view.tile.price, 0);
}

/**
 * The rent on a tile today. A street pays its base rent, doubled when the owner holds the whole
 * group and nobody has built; with houses it pays the house level. A railway pays by the
 * railways its owner holds; a utility is a multiple of the dice. A mortgaged or free tile earns
 * nothing.
 */
export function tileRent(
  board: BoardSnapshot,
  views: readonly TileView[],
  view: TileView,
): TileRent {
  const { tile, ownerPlayerId } = view;
  if (ownerPlayerId === null || view.mortgaged) return { kind: 'none' };
  const progress = groupProgress(views, tile.group, ownerPlayerId);
  if (tile.type === 'railway') {
    const amount = board.rules.railwayRent[String(progress.owned)];
    return amount === undefined
      ? { kind: 'none' }
      : { kind: 'amount', amount, level: progress.owned, monopolyDoubled: false };
  }
  if (tile.type === 'utility') {
    const multiplier = board.rules.utilityDiceMultiplier[String(progress.owned)];
    return multiplier === undefined
      ? { kind: 'none' }
      : { kind: 'dice', multiplier, count: progress.owned };
  }
  const rent = tile.rent;
  if (rent === undefined) return { kind: 'none' };
  const groupHasHouses = views.some(
    (candidate) => candidate.tile.group === tile.group && candidate.houses > 0,
  );
  if (view.houses > 0) {
    const level = Math.min(view.houses, 5);
    return { kind: 'amount', amount: rent[level] ?? 0, level, monopolyDoubled: false };
  }
  const doubled = progress.monopoly && !groupHasHouses;
  return {
    kind: 'amount',
    amount: doubled ? rent[0] * board.rules.monopolyBaseRentMultiplier : rent[0],
    level: 0,
    monopolyDoubled: doubled,
  };
}
