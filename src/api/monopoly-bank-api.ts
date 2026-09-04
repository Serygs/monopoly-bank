import type { ApiError, ApiResponse, BankruptcyRequest, CreateGameRequest, CreateTransactionRequest, CreateTransactionResponse, DeleteGameResponse, GameDetails, GameSummary, JoinGameRequest, LoginRequest, RegisterRequest, UpdateProfileRequest, UserProfile } from '../../shared/contracts/api.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { FinalGameSummary } from '../../shared/domain/game-summary.js';
import type { Player, Game } from '../../shared/types/monopoly.js';

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
  currentProfile(): Promise<UserProfile>; register(input: RegisterRequest): Promise<UserProfile>; login(input: LoginRequest): Promise<UserProfile>; logout(): Promise<void>; updateProfile(input: UpdateProfileRequest): Promise<UserProfile>;
  listGames(): Promise<GameSummary[]>;
  createGame(request: CreateGameRequest): Promise<GameDetails>;
  joinGame(request: JoinGameRequest): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
  deleteGame(gameId: string): Promise<DeleteGameResponse>;
  duplicateGame(gameId: string, gameAccessPassword: string): Promise<GameDetails>;
  finishGame(gameId: string): Promise<GameDetails>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
  createTransaction(gameId: string, request: CreateTransactionRequest): Promise<CreateTransactionResponse>;
  declareBankruptcy(gameId: string, request: BankruptcyRequest): Promise<CreateTransactionResponse>;
  getGameSummary(gameId: string): Promise<{ game: Game; winners: Player[] } & FinalGameSummary>;
  listTransactions(gameId: string, limit?: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit?: number): Promise<Transaction[]>;
}

class FetchMonopolyBankApi implements MonopolyBankApi {
  async currentProfile(): Promise<UserProfile> { return request<UserProfile>('/api/profile'); }
  async register(input: RegisterRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }); }
  async login(input: LoginRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }); }
  async logout(): Promise<void> { await request<null>('/api/auth/logout', { method: 'POST' }); }
  async updateProfile(input: UpdateProfileRequest): Promise<UserProfile> { return request<UserProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(input) }); }
  async listGames(): Promise<GameSummary[]> { return request<GameSummary[]>('/api/games'); }
  async createGame(input: CreateGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
  async joinGame(input: JoinGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games/join', { method: 'POST', body: JSON.stringify(input) }); }
  async getGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}`); }
  async deleteGame(gameId: string): Promise<DeleteGameResponse> { return request<DeleteGameResponse>(`/api/games/${encodeURIComponent(gameId)}`, { method: 'DELETE' }); }
  async duplicateGame(gameId: string, gameAccessPassword: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}/duplicate`, { method: 'POST', body: JSON.stringify({ gameAccessPassword }) }); }
  async finishGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}/finish`, commandInit({ method: 'POST' })); }
  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> { return request<number[]>(`/api/games/${encodeURIComponent(gameId)}/favorite-amounts`, { method: 'POST', body: JSON.stringify({ amount }) }); }
  async createTransaction(gameId: string, input: CreateTransactionRequest): Promise<CreateTransactionResponse> { return request<CreateTransactionResponse>(`/api/games/${encodeURIComponent(gameId)}/transactions`, commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async declareBankruptcy(gameId: string, input: BankruptcyRequest): Promise<CreateTransactionResponse> { return request<CreateTransactionResponse>(`/api/games/${encodeURIComponent(gameId)}/bankruptcy`, commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async getGameSummary(gameId: string): Promise<{ game: Game; winners: Player[] } & FinalGameSummary> { return request<{ game: Game; winners: Player[] } & FinalGameSummary>(`/api/games/${encodeURIComponent(gameId)}/summary`); }
  async listTransactions(gameId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/transactions?limit=${limit}`); }
  async listPlayerTransactions(gameId: string, playerId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/transactions?limit=${limit}`); }
}

function commandInit(init: RequestInit): RequestInit { return { ...init, headers: { ...init.headers, 'x-command-id': crypto.randomUUID() } }; }

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
