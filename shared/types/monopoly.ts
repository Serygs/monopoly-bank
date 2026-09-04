export const gameStatuses = ['ACTIVE', 'FINISHED'] as const;

export type GameStatus = (typeof gameStatuses)[number];

export const currencies = ['USD', 'EUR', 'UAH', 'K'] as const;
export type Currency = (typeof currencies)[number];

export const transactionTypes = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PAY_RENT',
  'PASS_GO',
  'BANKRUPTCY_TRANSFER',
] as const;

export type TransactionType = (typeof transactionTypes)[number];

export interface Game {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
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
