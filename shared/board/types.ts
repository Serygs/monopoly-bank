export const propertyGroupIds = [
  'brown',
  'lightblue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'blue',
  'railway',
  'utility',
] as const;
export type PropertyGroupId = (typeof propertyGroupIds)[number];

export type PropertyTileType = 'street' | 'railway' | 'utility';

/** Rent for [base, 1 house, 2 houses, 3 houses, 4 houses, hotel]. */
export type StreetRent = readonly [number, number, number, number, number, number];

export interface PropertyTile {
  /** Stable snake_case id, used as `tile_id` in `game_properties`. Never rename. */
  id: string;
  /** Board position, 0-39. */
  pos: number;
  name: string;
  type: PropertyTileType;
  group: PropertyGroupId;
  price: number;
  mortgage: number;
  rent?: StreetRent;
  houseCost?: number;
}

export type NonPropertyTile =
  | { pos: number; type: 'go'; reward: number }
  | { pos: number; type: 'tax'; name: string; amount: number }
  | { pos: number; type: 'jail' | 'free_parking' | 'go_to_jail' | 'community_chest' | 'chance' };

export interface BoardRules {
  monopolyBaseRentMultiplier: number;
  hotelReplacesHouses: number;
  buildEvenly: boolean;
  sellBuildingRefund: number;
  /** Rent by number of railways owned. */
  railwayRent: Record<string, number>;
  /** Multiplier of the dice sum by number of utilities owned. */
  utilityDiceMultiplier: Record<string, number>;
}

/** The static catalog, in base amounts (starting balance `baseStartBalance`). */
export interface BoardPreset {
  presetId: string;
  version: number;
  title: string;
  baseStartBalance: number;
  currency: string;
  mortgageRedeemMultiplier: number;
  groups: Partial<Record<PropertyGroupId, { size: number }>>;
  rules: BoardRules;
  tiles: readonly PropertyTile[];
  nonPropertyTiles: readonly NonPropertyTile[];
}

/** The preset scaled to one game's money unit and frozen into `GameSettings.board`. */
export interface BoardSnapshot extends Omit<BoardPreset, 'baseStartBalance' | 'currency'> {
  /** unit / (baseStartBalance / 150); applied to every base amount at game creation. */
  multiplier: number;
  incomeTax: number;
  luxuryTax: number;
  goReward: number;
}
