import type { Currency, Game, Player, Transaction, TransactionType } from '../types/monopoly.js';

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, string | number>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface GameSummary {
  game: Game;
  playerCount: number;
}

export interface GameDetails {
  game: Game;
  players: Player[];
  favoriteAmounts?: number[];
  recentAmounts?: number[];
  canManage?: boolean;
}

export interface DeleteGameResponse {
  gameId: string;
}

export interface CreateGameRequest {
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  gameAccessPassword: string;
  players: CreateGamePlayerRequest[];
}

export interface RegisterRequest { nickname: string; avatar: string; password: string; }
export interface LoginRequest { nickname: string; password: string; }
export interface UpdateProfileRequest { nickname: string; avatar: string; }
export interface JoinGameRequest { joinCode: string; gameAccessPassword: string; playerId?: string; }
export interface DuplicateGameRequest { gameAccessPassword: string; }
export interface UserProfile { id: string; nickname: string; avatar: string; gamesPlayed: number; gamesWon: number; winRate: number; createdAt: string; updatedAt: string; }

export interface CreateGamePlayerRequest {
  name: string;
  color: string;
}

interface TransactionRequestBase {
  type: TransactionType;
  comment?: string;
}

export interface PlayerToPlayerTransactionRequest extends TransactionRequestBase {
  type: 'PLAYER_TO_PLAYER';
  sourcePlayerId: string;
  destinationPlayerId: string;
  amount: number;
}

export interface PlayerToBankTransactionRequest extends TransactionRequestBase {
  type: 'PLAYER_TO_BANK';
  playerId: string;
  amount: number;
}

export interface BankToPlayerTransactionRequest extends TransactionRequestBase {
  type: 'BANK_TO_PLAYER';
  playerId: string;
  amount: number;
}

export interface PlayerToAllTransactionRequest extends TransactionRequestBase {
  type: 'PLAYER_TO_ALL';
  payerPlayerId: string;
  amountPerPlayer: number;
}

export interface AllToPlayerTransactionRequest extends TransactionRequestBase {
  type: 'ALL_TO_PLAYER';
  recipientPlayerId: string;
  amountPerPlayer: number;
}

export interface PassGoTransactionRequest extends TransactionRequestBase {
  type: 'PASS_GO';
  playerId: string;
}

export interface BankruptcyRequest {
  playerId: string;
  creditorPlayerId?: string;
}

export interface SetJailRequest { isInJail: boolean; }
export interface DiceRollRequest { playerId: string; first: number; second: number; }
export interface DiceRollResponse { player: Player; thirdDouble: boolean; }
export interface GameSummaryStatistics {
  durationMs: number;
  totalTransactions: number;
  totalMoneyTransferred: number;
  largestSinglePayment: number;
  richestActivePlayer: Player | null;
  lowestActiveBalance: number | null;
  players: Array<{ player: Player; totalReceived: number; totalPaid: number; passGoCount: number; transactionCount: number }>;
}
export interface FinalGameSummaryResponse extends GameSummaryStatistics { playerToPlayerTotal: number; paidToBank: number; receivedFromBank: number; largestTransaction: number; biggestSenderId: string | null; leastSenderId: string | null; biggestPayerRecipient: { payerId: string; recipientId: string; amount: number; transactionCount: number } | null; }

export type CreateTransactionRequest =
  | PlayerToPlayerTransactionRequest
  | PlayerToBankTransactionRequest
  | BankToPlayerTransactionRequest
  | PlayerToAllTransactionRequest
  | AllToPlayerTransactionRequest
  | PassGoTransactionRequest;

export interface CreateTransactionResponse {
  transaction: Transaction;
  players: Player[];
}
