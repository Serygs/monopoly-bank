import type { BoardSnapshot, PropertyGroupId } from '../../../shared/board';
import { sellRefund } from '../../../shared/domain/property';
import {
  buildingGroups,
  groupStreets,
  mortgageableTiles,
  previewBuildings,
  type BuildingPreview,
  type TileView,
} from '../../utils/property-view';
import { buildRequest } from './game-page-helpers';

/** What the player has chosen to turn into cash in the "Find funds" menu. */
export interface RaisePlan {
  /** The wanted level of each street whose stepper was touched (tile id -> 0-5). */
  levels: Readonly<Record<string, number>>;
  mortgageIds: readonly string[];
}

export const emptyRaisePlan: RaisePlan = { levels: {}, mortgageIds: [] };

export interface RaiseGroup {
  group: PropertyGroupId;
  /** The plan's levels for this group's streets only, as one stepper shows them. */
  levels: Record<string, number>;
  preview: BuildingPreview;
}

export interface RaiseSummary {
  groups: RaiseGroup[];
  /** What can be mortgaged once the planned sales are done. */
  mortgageable: TileView[];
  /**
   * The chosen tiles that can still be mortgaged. Derived rather than stored, so a tile drops out by
   * itself when its group gets a building back or a retry finds it already mortgaged.
   */
  mortgages: TileView[];
  /** A group's plan breaks the building rules, so it cannot be reviewed yet. */
  invalid: boolean;
  /** What the plan brings in; it follows the steppers even while a group is invalid. */
  gain: number;
  /** What selling every building and mortgaging every tile would bring in. */
  maxGain: number;
}

function ownedLevels(
  views: readonly TileView[],
  group: PropertyGroupId,
  levels: RaisePlan['levels'],
): Record<string, number> {
  return Object.fromEntries(
    groupStreets(views, group).flatMap((view) => {
      const level = levels[view.tile.id];
      return level === undefined ? [] : [[view.tile.id, level] as const];
    }),
  );
}

function mortgageTotal(tiles: readonly TileView[]): number {
  return tiles.reduce((sum, view) => sum + view.tile.mortgage, 0);
}

export function raiseSummary(
  board: BoardSnapshot,
  views: readonly TileView[],
  playerId: string,
  plan: RaisePlan,
): RaiseSummary {
  const groups = buildingGroups(board, views, playerId, 'SELL').map((group) => {
    const levels = ownedLevels(views, group, plan.levels);
    return { group, levels, preview: previewBuildings(board, views, playerId, levels, 'SELL') };
  });
  const owned = views.filter((view) => view.ownerPlayerId === playerId);
  const sold = owned.reduce((sum, view) => {
    const level = plan.levels[view.tile.id] ?? view.houses;
    return sum + Math.max(0, view.houses - level) * sellRefund(board, view.tile.id);
  }, 0);
  const allBuildings = owned.reduce(
    (sum, view) => sum + view.houses * sellRefund(board, view.tile.id),
    0,
  );
  const afterSale = views.map((view) => ({
    ...view,
    houses: plan.levels[view.tile.id] ?? view.houses,
  }));
  const afterAllSold = views.map((view) =>
    view.ownerPlayerId === playerId ? { ...view, houses: 0 } : view,
  );
  const mortgageable = mortgageableTiles(afterSale, playerId);
  const mortgages = mortgageable.filter((view) => plan.mortgageIds.includes(view.tile.id));
  return {
    groups,
    mortgageable,
    mortgages,
    invalid: groups.some(({ preview }) => !preview.ok && preview.reason !== 'NOTHING'),
    gain: sold + mortgageTotal(mortgages),
    maxGain: allBuildings + mortgageTotal(mortgageableTiles(afterAllSold, playerId)),
  };
}

/**
 * The operations to record, in order: the sales first, because a tile cannot be mortgaged while its
 * colour group still has buildings. Each stays its own transaction with its own reversal.
 */
export function raiseRequests(playerId: string, summary: RaiseSummary) {
  const sales = summary.groups.flatMap(({ preview }) =>
    preview.ok
      ? [
          buildRequest('PROPERTY_SELL_BUILDING', playerId, '', preview.amount, '', {
            targets: preview.targets,
          }),
        ]
      : [],
  );
  const mortgages = summary.mortgages.map((view) =>
    buildRequest('MORTGAGE', playerId, '', view.tile.mortgage, '', { tileId: view.tile.id }),
  );
  return [...sales, ...mortgages].filter((request) => request !== null);
}

export interface RaiseTotals {
  payment: number;
  afterSelected: number;
  /** Below zero while the selection does not cover the payment. */
  left: number;
  afterAll: number;
  leftAfterAll: number;
}

export function raiseTotals(
  available: number,
  shortfall: number,
  gain: number,
  maxGain: number,
): RaiseTotals {
  const payment = available + shortfall;
  return {
    payment,
    afterSelected: available + gain,
    left: available + gain - payment,
    afterAll: available + maxGain,
    leftAfterAll: available + maxGain - payment,
  };
}
