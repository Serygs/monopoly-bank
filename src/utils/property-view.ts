import type { BoardSnapshot, PropertyGroupId, PropertyTile } from '../../shared/board';
import {
  buildCost,
  canBuild,
  canSellBuilding,
  MAX_BUILDINGS,
  planBuildings,
  sellRefund,
  UTILITY_RENT_UNIT,
} from '../../shared/domain/property';
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

/**
 * The colour groups from the cheapest to the dearest, by their cheapest tile (ties by board
 * position). It follows the snapshot prices, so a scaled or custom board keeps the right order:
 * brown, light blue, pink, utilities, orange, railways, red, yellow, green, blue on the classic one.
 */
export function groupOrder(views: readonly TileView[]): PropertyGroupId[] {
  const cheapest = new Map<PropertyGroupId, { price: number; pos: number }>();
  for (const { tile } of views) {
    const current = cheapest.get(tile.group);
    if (
      current === undefined ||
      tile.price < current.price ||
      (tile.price === current.price && tile.pos < current.pos)
    )
      cheapest.set(tile.group, { price: tile.price, pos: tile.pos });
  }
  return [...cheapest.entries()]
    .sort(([, a], [, b]) => a.price - b.price || a.pos - b.pos)
    .map(([group]) => group);
}

export interface GroupCards {
  group: PropertyGroupId;
  cards: TileView[];
}

/** Cards split into colour groups in `order`; inside a group by price, ties by board position. */
export function cardsByGroup(
  cards: readonly TileView[],
  order: readonly PropertyGroupId[],
): GroupCards[] {
  return order
    .map((group) => ({
      group,
      cards: cards
        .filter((card) => card.tile.group === group)
        .sort((a, b) => a.tile.price - b.tile.price || a.tile.pos - b.tile.pos),
    }))
    .filter((entry) => entry.cards.length > 0);
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

/** Merges the registry rows a response or live event changed into the loaded registry, by tileId. */
export function mergeProperties(
  current: readonly GameProperty[] | undefined,
  changed: readonly GameProperty[],
): GameProperty[] {
  const merged = new Map((current ?? []).map((row) => [row.tileId, row]));
  for (const row of changed) merged.set(row.tileId, row);
  return [...merged.values()];
}

/** A utility's rent is a multiple of the dice total the payer enters (two dice: 2 to 12). */
export function isDiceSum(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && value <= 12;
}

/**
 * The rent the payer owes for a tile, or `null` when nothing is due (free or mortgaged tile) or a
 * utility still lacks a valid dice total. Same logic as `tileRent`, extended with the dice total;
 * the server works it out again and is authoritative.
 */
export function rentDue(
  board: BoardSnapshot,
  views: readonly TileView[],
  view: TileView,
  diceSum?: number,
): number | null {
  const rent = tileRent(board, views, view);
  if (rent.kind === 'amount') return rent.amount;
  if (rent.kind === 'dice')
    return diceSum !== undefined && isDiceSum(diceSum)
      ? diceSum * rent.multiplier * UTILITY_RENT_UNIT
      : null;
  return null;
}

/** Tiles nobody owns: what a player may buy or put up for auction. */
export function freeTiles(views: readonly TileView[]): TileView[] {
  return views.filter((view) => view.status === 'free');
}

/** The player's own unmortgaged tiles that may be mortgaged: no buildings on the tile or its group. */
export function mortgageableTiles(views: readonly TileView[], playerId: string): TileView[] {
  return views.filter(
    (view) =>
      view.ownerPlayerId === playerId &&
      !view.mortgaged &&
      !views.some((other) => other.tile.group === view.tile.group && other.houses > 0),
  );
}

/** Tiles another player owns and that still earn rent: what the payer may pay rent on. */
export function rentableTiles(views: readonly TileView[], payerPlayerId: string): TileView[] {
  return views.filter(
    (view) =>
      view.ownerPlayerId !== null && view.ownerPlayerId !== payerPlayerId && !view.mortgaged,
  );
}

/** The registry rows behind the views, for the shared building rules. */
export function registryOf(views: readonly TileView[]): GameProperty[] {
  return views.map((view) => ({
    gameId: '',
    tileId: view.tile.id,
    ownerPlayerId: view.ownerPlayerId,
    mortgaged: view.mortgaged,
    houses: view.houses,
  }));
}

/** The player's streets that may take another house or the hotel now. */
export function buildableTiles(
  board: BoardSnapshot,
  views: readonly TileView[],
  playerId: string,
): TileView[] {
  const registry = registryOf(views);
  return views.filter((view) => canBuild(board, registry, view.tile.id, playerId));
}

/** The player's streets with a building that may be sold now. */
export function sellableTiles(
  board: BoardSnapshot,
  views: readonly TileView[],
  playerId: string,
): TileView[] {
  const registry = registryOf(views);
  return views.filter((view) => canSellBuilding(board, registry, view.tile.id, playerId));
}

export type TileIntentKind =
  | 'PROPERTY_PURCHASE'
  | 'MORTGAGE'
  | 'MORTGAGE_REDEMPTION'
  | 'AUCTION'
  | 'PAY_RENT'
  | 'PROPERTY_BUILD'
  | 'PROPERTY_SELL_BUILDING'
  | 'PROPERTY_TRANSFER';

/** An action a wallet can start on one tile, with the wallet that performs it. */
export interface TileIntent {
  kind: TileIntentKind;
  tileId: string;
  playerId: string;
}

/**
 * The actions offered on a tile's sheet. Owner actions use the owning wallet (it must be one the
 * viewer controls); buying, bidding-off and paying rent use the viewer's acting wallet.
 */
export function tileIntents(
  board: BoardSnapshot,
  views: readonly TileView[],
  view: TileView,
  options: {
    controlledPlayerIds: readonly string[];
    actorPlayerId: string | null;
    auctionsAvailable: boolean;
  },
): TileIntent[] {
  const { controlledPlayerIds, actorPlayerId, auctionsAvailable } = options;
  const tileId = view.tile.id;
  const intents: TileIntent[] = [];
  if (view.status === 'free' && actorPlayerId !== null) {
    intents.push({ kind: 'PROPERTY_PURCHASE', tileId, playerId: actorPlayerId });
    if (auctionsAvailable) intents.push({ kind: 'AUCTION', tileId, playerId: actorPlayerId });
  }
  const owner = view.ownerPlayerId;
  if (owner !== null && controlledPlayerIds.includes(owner)) {
    if (view.mortgaged) intents.push({ kind: 'MORTGAGE_REDEMPTION', tileId, playerId: owner });
    else if (mortgageableTiles(views, owner).some((candidate) => candidate.tile.id === tileId))
      intents.push({ kind: 'MORTGAGE', tileId, playerId: owner });
    if (buildableTiles(board, views, owner).some((candidate) => candidate.tile.id === tileId))
      intents.push({ kind: 'PROPERTY_BUILD', tileId, playerId: owner });
    if (sellableTiles(board, views, owner).some((candidate) => candidate.tile.id === tileId))
      intents.push({ kind: 'PROPERTY_SELL_BUILDING', tileId, playerId: owner });
  }
  if (owner !== null && actorPlayerId !== null && owner !== actorPlayerId && !view.mortgaged)
    intents.push({ kind: 'PAY_RENT', tileId, playerId: actorPlayerId });
  // A trade starts from either side of a tile; tiles of a group with buildings cannot be traded.
  const groupBuilt = views.some(
    (other) => other.tile.group === view.tile.group && other.houses > 0,
  );
  if (owner !== null && !groupBuilt) {
    if (controlledPlayerIds.includes(owner))
      intents.push({ kind: 'PROPERTY_TRANSFER', tileId, playerId: owner });
    else if (actorPlayerId !== null && owner !== actorPlayerId)
      intents.push({ kind: 'PROPERTY_TRANSFER', tileId, playerId: actorPlayerId });
  }
  return intents;
}

export type BuildMode = 'BUILD' | 'SELL';

/** The colour groups where the player may build (or sell) something now, in board order. */
export function buildingGroups(
  board: BoardSnapshot,
  views: readonly TileView[],
  playerId: string,
  mode: BuildMode,
): PropertyGroupId[] {
  const tiles =
    mode === 'BUILD'
      ? buildableTiles(board, views, playerId)
      : sellableTiles(board, views, playerId);
  return [...new Set(tiles.map((view) => view.tile.group))];
}

/** The streets of a colour group in board order. */
export function groupStreets(views: readonly TileView[], group: PropertyGroupId): TileView[] {
  return views.filter((view) => view.tile.group === group);
}

export type BuildingPreview =
  | {
      ok: true;
      /** Only the streets whose level changes: tile id -> final level. */
      targets: Record<string, number>;
      /** Buildings added or sold in total. */
      buildings: number;
      /** What the bank is paid (build) or pays (sell). */
      amount: number;
    }
  | {
      ok: false;
      /** `NOTHING` while no street changed, otherwise the Worker's error code for the plan. */
      reason: 'NOTHING' | string;
    };

/**
 * What setting the streets of one group to `levels` (tile id -> final level) would do, validated
 * on the final state by the same rule the Worker applies. Streets without an entry keep their level.
 */
export function previewBuildings(
  board: BoardSnapshot,
  views: readonly TileView[],
  playerId: string,
  levels: Readonly<Record<string, number>>,
  mode: BuildMode,
): BuildingPreview {
  const targets: Record<string, number> = {};
  for (const [tileId, level] of Object.entries(levels)) {
    const current = views.find((view) => view.tile.id === tileId)?.houses ?? 0;
    if (level !== current) targets[tileId] = level;
  }
  if (Object.keys(targets).length === 0) return { ok: false, reason: 'NOTHING' };
  try {
    const plan = planBuildings({ board, registry: registryOf(views) }, playerId, targets, mode);
    const amount = plan.changes.reduce(
      (sum, change) =>
        sum +
        Math.abs(change.after.houses - change.before.houses) *
          (mode === 'BUILD' ? buildCost(board, change.tileId) : sellRefund(board, change.tileId)),
      0,
    );
    return { ok: true, targets, buildings: plan.buildings, amount };
  } catch (error) {
    // The plan's errors carry a stable `code`; anything else is reported as invalid.
    const code = (error as { code?: unknown }).code;
    return { ok: false, reason: typeof code === 'string' ? code : 'INVALID' };
  }
}

/** The lowest and highest level a street may be set to in the given mode. */
export function levelBounds(view: TileView, mode: BuildMode): { min: number; max: number } {
  return mode === 'BUILD' ? { min: view.houses, max: MAX_BUILDINGS } : { min: 0, max: view.houses };
}

/** One card of an ownership strip: its group colour, whether anybody holds it, an owner ring. */
export interface PropertyStripCard {
  tileId: string;
  /** The colour group; the strip leaves a wider gap where the group changes. */
  group: PropertyGroupId;
  color: string;
  owned: boolean;
  /** The owner's player colour, drawn as a ring around the viewer's own cards. */
  ring?: string;
}

/** Cards in strip order: colour groups cheapest first (over the whole board), by price inside. */
function stripOrder(views: readonly TileView[], cards: readonly TileView[]): TileView[] {
  return cardsByGroup(cards, groupOrder(views)).flatMap((entry) => entry.cards);
}

/**
 * Every tile of the board for the viewer's own strip: held cards are solid, free ones pale, and
 * the cards of the wallets the viewer controls carry a ring in that wallet's colour.
 */
export function boardStrip(
  views: readonly TileView[],
  controlledPlayerIds: readonly string[],
  playerColors: ReadonlyMap<string, string>,
): PropertyStripCard[] {
  return stripOrder(views, views).map((view) => {
    const owner = view.ownerPlayerId;
    const ring =
      owner !== null && controlledPlayerIds.includes(owner) ? playerColors.get(owner) : undefined;
    return {
      tileId: view.tile.id,
      group: view.tile.group,
      color: propertyGroupColors[view.tile.group],
      owned: owner !== null,
      ...(ring === undefined ? {} : { ring }),
    };
  });
}

/** The cards one player holds, in strip order. */
export function playerStrip(views: readonly TileView[], playerId: string): PropertyStripCard[] {
  return stripOrder(
    views,
    views.filter((view) => view.ownerPlayerId === playerId),
  ).map((view) => ({
    tileId: view.tile.id,
    group: view.tile.group,
    color: propertyGroupColors[view.tile.group],
    owned: true,
  }));
}
