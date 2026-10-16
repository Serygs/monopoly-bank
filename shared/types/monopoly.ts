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

/** Optional house rules, chosen with the lobby and fixed once it exists. All are off by default. */
export const gameRuleKeys = [
  'doubleRewardOnExactGo',
  'playerLoans',
  'bankLoans',
  'freeParkingJackpot',
  'auctions',
] as const;
export type GameRuleKey = (typeof gameRuleKeys)[number];
export type GameRules = Record<GameRuleKey, boolean>;

export const defaultGameRules: GameRules = {
  doubleRewardOnExactGo: false,
  playerLoans: false,
  bankLoans: false,
  freeParkingJackpot: false,
  auctions: false,
};

/**
 * Amounts derived once from the starting balance when the game is created, in whole currency
 * units. Games created before the snapshot existed have none.
 */
export interface GameSettings {
  /** The money unit: the starting balance divided by 150, rounded to a 1-2-5 value (minimum 10). */
  unit: number;
  incomeTax: number;
  luxuryTax: number;
  jailFine: number;
  bankLoanMax: number;
  auctionMinBid: number;
  /** The auction bid buttons: 1, 2.5, 5 and 10 units. */
  auctionBidSteps: number[];
}

export const transactionTypes = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PAY_RENT',
  'PASS_GO',
  'BANKRUPTCY_TRANSFER',
  'REVERSAL',
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
  rules: GameRules;
  settings: GameSettings | null;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
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
  /** Set on a REVERSAL: the transaction it moved back. */
  reversesTransactionId?: string | null;
  /** Set on a reversed transaction: the REVERSAL that moved it back. */
  reversedByTransactionId?: string | null;
}
