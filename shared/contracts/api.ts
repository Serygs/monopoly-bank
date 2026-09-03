import type { Game, Player, Transaction, TransactionType } from '../types/monopoly.js';

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
}

export interface DeleteGameResponse {
  gameId: string;
}

export interface CreateGameRequest {
  name: string;
  startingBalance: number;
  passGoReward: number;
  players: CreateGamePlayerRequest[];
}

export interface CreateGamePlayerRequest {
  name: string;
  color: string;
}

interface TransactionRequestBase {
  type: TransactionType;
  comment?: string;
}

export interface PlayerToPlayerTransactionRequest extends TransactionRequestBase {
  type: 'PLAYER_TO_PLAYER' | 'PAY_RENT';
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
