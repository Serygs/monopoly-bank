export const gameStatuses = ['LOBBY', 'ACTIVE', 'FINISHED'] as const;

export type GameStatus = (typeof gameStatuses)[number];

/** Currencies a new game can be created with. */
export const selectableCurrencies = ['USD', 'EUR', 'UAH'] as const;
export type SelectableCurrency = (typeof selectableCurrencies)[number];

/** Every currency a stored game may carry. `K` is legacy: existing games keep it, new games cannot choose it. */
export const currencies = [...selectableCurrencies, 'K'] as const;
export type Currency = (typeof currencies)[number];

export const paymentModes = ['FAST', 'CONFIRMATION'] as const;
export type PaymentMode = (typeof paymentModes)[number];

export const transactionTypes = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PAY_RENT',
  'PASS_GO',
  'BANKRUPTCY_TRANSFER',
  'PROPERTY_PURCHASE',
  'PROPERTY_RENT',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDINGS',
  'PROPERTY_MORTGAGE',
  'PROPERTY_UNMORTGAGE',
  'PROPERTY_AUCTION',
  'PROPERTY_TRADE',
  'JAIL_BAIL',
] as const;

export type TransactionType = (typeof transactionTypes)[number];

export interface Game {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  /** Set at lobby creation and immutable once the game starts. */
  paymentMode: PaymentMode;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  /** The board this game opted into; `null` (or absent) for a game that only banks money. */
  boardId?: string | null;
}

export interface Player {
  id: string;
  gameId: string;
  name: string;
  color: string;
  balance: number;
  status?: PlayerStatus;
  isInJail?: boolean;
  consecutiveDoubles?: number;
  /** The receipt of the last recorded roll, kept only so utility rent can be settled server-side. */
  lastRollTotal?: number | null;
  lastRollAt?: string | null;
  /** Set when this wallet belongs to a registered Monopoly Bank account. */
  userId?: string | null;
  createdAt: string;
}

export const playerStatuses = ['ACTIVE', 'BANKRUPT'] as const;
export type PlayerStatus = (typeof playerStatuses)[number];

export interface TransactionParticipant {
  playerId: string;
  balanceDelta: number;
}

export interface Transaction {
  id: string;
  gameId: string;
  type: TransactionType;
  amount: number;
  totalAmount: number;
  comment: string | null;
  createdAt: string;
  participants: TransactionParticipant[];
}

/** Only ownable spaces are catalogued, which is why the board dictionary knows three kinds and no corners. */
export const boardSpaceKinds = ['STREET', 'RAILROAD', 'UTILITY'] as const;
export type BoardSpaceKind = (typeof boardSpaceKinds)[number];

/** The eight street colours plus the two pseudo-groups the railroads and the utilities form. */
export const colorGroups = [
  'BROWN',
  'LIGHT_BLUE',
  'PINK',
  'ORANGE',
  'RED',
  'YELLOW',
  'GREEN',
  'DARK_BLUE',
  'RAILROAD',
  'UTILITY',
] as const;
export type ColorGroup = (typeof colorGroups)[number];

/**
 * A catalogued space. `customName` is filled only by user-owned board copies;
 * canonical rows stay `null` and render through `translationKey`.
 * `rents` holds the levels a space actually has: six for a street
 * (base plus four house levels plus the hotel), four for a railroad
 * (one to four owned) and none for a utility, whose rent is dice-driven.
 */
export interface BoardSpace {
  id: string;
  boardIndex: number;
  kind: BoardSpaceKind;
  colorGroup: ColorGroup;
  translationKey: string;
  customName: string | null;
  price: number;
  mortgageValue: number;
  houseCost: number | null;
  rents: number[];
}

/** The tunable parameters of a board; a game without a board never reads them. */
export interface BoardDefinition {
  id: string;
  name: string;
  jailFee: number;
  unmortgageInterestPercent: number;
  houseBankLimit: number;
  hotelBankLimit: number;
  utilityMultiplierSingle: number;
  utilityMultiplierPair: number;
}

/** Ownership of one catalogued space inside one game. `houses` is 0..5, where 5 is a hotel. */
export interface GameProperty {
  boardSpaceId: string;
  ownerPlayerId: string | null;
  houses: number;
  mortgaged: boolean;
}

/** Houses and hotels are a finite shared pool, counted per game. */
export interface BuildingBank {
  housesAvailable: number;
  hotelsAvailable: number;
}

/** A hotel occupies the fifth building level of a space. */
export const hotelHouseLevel = 5;
