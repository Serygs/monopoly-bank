import { monopolyRu2012 } from './monopoly-ru-2012.js';
import type { BoardPreset, BoardSnapshot, PropertyTile } from './types.js';

export * from './types.js';
export { monopolyRu2012 };

/** Board modes a game can be created with. 'custom' is reserved for a later phase. */
export const boardModes = ['none', 'monopoly-ru-2012'] as const;
export type BoardMode = (typeof boardModes)[number];

export function isBoardMode(value: unknown): value is BoardMode {
  return typeof value === 'string' && (boardModes as readonly string[]).includes(value);
}

const presets: Record<Exclude<BoardMode, 'none'>, BoardPreset> = {
  'monopoly-ru-2012': monopolyRu2012,
};

export function getBoardPreset(mode: Exclude<BoardMode, 'none'>): BoardPreset {
  return presets[mode];
}

/** Units per money unit at the preset's base: base starting balance / 150. */
const UNITS_PER_STARTING_BALANCE = 150;

/** Scales a base amount to a game's money unit, rounding half up to a whole number. */
export function scaleBoardAmount(preset: BoardPreset, unit: number, baseAmount: number): number {
  return Math.round((baseAmount * unit * UNITS_PER_STARTING_BALANCE) / preset.baseStartBalance);
}

/** Copies the preset into a per-game snapshot, scaled by the game's money unit. */
export function buildBoardSnapshot(preset: BoardPreset, unit: number): BoardSnapshot {
  const scale = (amount: number): number => scaleBoardAmount(preset, unit, amount);
  const tiles: PropertyTile[] = preset.tiles.map((tile) => ({
    ...tile,
    price: scale(tile.price),
    mortgage: scale(tile.mortgage),
    ...(tile.rent ? { rent: tile.rent.map(scale) as unknown as PropertyTile['rent'] } : {}),
    ...(tile.houseCost === undefined ? {} : { houseCost: scale(tile.houseCost) }),
  }));
  const railwayRent = Object.fromEntries(
    Object.entries(preset.rules.railwayRent).map(([count, rent]) => [count, scale(rent)]),
  );
  const taxes = preset.nonPropertyTiles.filter((tile) => tile.type === 'tax');
  const go = preset.nonPropertyTiles.find((tile) => tile.type === 'go');
  const [incomeTax, luxuryTax] = taxes.map((tile) => scale(tile.type === 'tax' ? tile.amount : 0));
  return {
    presetId: preset.presetId,
    version: preset.version,
    title: preset.title,
    mortgageRedeemMultiplier: preset.mortgageRedeemMultiplier,
    groups: preset.groups,
    rules: { ...preset.rules, railwayRent },
    tiles,
    nonPropertyTiles: preset.nonPropertyTiles,
    multiplier: (unit * UNITS_PER_STARTING_BALANCE) / preset.baseStartBalance,
    incomeTax: incomeTax ?? 0,
    luxuryTax: luxuryTax ?? 0,
    goReward: go && go.type === 'go' ? scale(go.reward) : 0,
  };
}

export function findTile(board: BoardSnapshot, tileId: string): PropertyTile | undefined {
  return board.tiles.find((tile) => tile.id === tileId);
}
