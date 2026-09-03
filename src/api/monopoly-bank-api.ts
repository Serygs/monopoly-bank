import type { ApiError, ApiResponse, CreateGameRequest, CreateTransactionRequest, CreateTransactionResponse, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import type { Transaction } from '../../shared/types/monopoly.js';

export class MonopolyBankApiError extends Error {
  readonly code: string;
  readonly details: Record<string, string | number> | undefined;

  constructor(error: ApiError['error']) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

export interface MonopolyBankApi {
  listGames(): Promise<GameSummary[]>;
  createGame(request: CreateGameRequest): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
  createTransaction(gameId: string, request: CreateTransactionRequest): Promise<CreateTransactionResponse>;
  listTransactions(gameId: string, limit?: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit?: number): Promise<Transaction[]>;
}

class FetchMonopolyBankApi implements MonopolyBankApi {
  async listGames(): Promise<GameSummary[]> { return request<GameSummary[]>('/api/games'); }
  async createGame(input: CreateGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
  async getGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}`); }
  async createTransaction(gameId: string, input: CreateTransactionRequest): Promise<CreateTransactionResponse> { return request<CreateTransactionResponse>(`/api/games/${encodeURIComponent(gameId)}/transactions`, { method: 'POST', body: JSON.stringify(input) }); }
  async listTransactions(gameId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/transactions?limit=${limit}`); }
  async listPlayerTransactions(gameId: string, playerId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/transactions?limit=${limit}`); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } });
  } catch {
    throw new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'Unable to reach Monopoly Bank. Please try again.' });
  }
  const payload: unknown = await response.json().catch(() => null);
  if (isApiError(payload)) throw new MonopolyBankApiError(payload.error);
  if (!response.ok || !isApiSuccess<T>(payload)) throw new MonopolyBankApiError({ code: 'API_ERROR', message: 'The server returned an unexpected response.' });
  return payload.data;
}

function isApiSuccess<T>(value: unknown): value is ApiResponse<T> & { data: T } { return value !== null && typeof value === 'object' && 'data' in value; }
function isApiError(value: unknown): value is ApiError { return value !== null && typeof value === 'object' && 'error' in value; }

export const monopolyBankApi: MonopolyBankApi = new FetchMonopolyBankApi();
