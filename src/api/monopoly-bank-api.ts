import type { ApiError, ApiResponse, CreateGameRequest, GameDetails, GameSummary } from '../../shared/contracts/api.js';

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
}

class FetchMonopolyBankApi implements MonopolyBankApi {
  async listGames(): Promise<GameSummary[]> { return request<GameSummary[]>('/api/games'); }
  async createGame(input: CreateGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
  async getGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}`); }
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
