import type { AccountExport, ActivityPage, ActivityScope, AddAccountEmailRequest, ApiError, ApiResponse, BankruptcyRequest, BankruptcyResponse, BoardDetails, BoardSummary, CreateBankingCommandResponse, CreateBoardRequest, CreateGameRequest, CreateInvitationResponse, CreatePaymentRequestResponse, CreateTradeRequest, CreateTransactionRequest, CreateTransactionResponse, DeleteBoardResponse, DeleteGameResponse, DiceRollRequest, DiceRollResponse, FinishGameRequest, GameDetails, GameSummary, GuestJoinGameRequest, GuestJoinGameResponse, JailBailRequest, JoinGameRequest, LedgerStatistics, LoginRequest, PaymentRequest, PaymentRequestActionResponse, PropertyAuctionRequest, PropertyBuildRequest, PropertyMortgageRequest, PropertyOperationResponse, PropertyPurchaseRequest, PropertyRentRequest, PropertySellBuildingsRequest, PropertyStateResponse, PropertyTrade, PropertyUnmortgageRequest, RegisterRequest, RevokeInvitationResponse, TradeActionResponse, UpdateProfileRequest, UpgradeGuestRequest, UserProfile } from '../../shared/contracts/api.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { Player, Game } from '../../shared/types/monopoly.js';

export class MonopolyBankApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(error: ApiError['error']) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

export interface MonopolyBankApi {
  currentProfile(): Promise<UserProfile>; register(input: RegisterRequest): Promise<UserProfile>; login(input: LoginRequest): Promise<UserProfile>; logout(): Promise<void>; updateProfile(input: UpdateProfileRequest): Promise<UserProfile>;
  verifyEmail(token: string): Promise<UserProfile>; requestPasswordReset(email: string): Promise<void>; confirmPasswordReset(token: string, password: string): Promise<void>; resendVerification(): Promise<void>;
  listGames(): Promise<GameSummary[]>;
  createGame(request: CreateGameRequest): Promise<GameDetails>;
  joinGame(request: JoinGameRequest): Promise<GameDetails>;
  joinGameAsGuest(request: GuestJoinGameRequest): Promise<GuestJoinGameResponse>;
  upgradeGuest(input: UpgradeGuestRequest): Promise<UserProfile>;
  addEmailToLegacyAccount(input: AddAccountEmailRequest): Promise<UserProfile>;
  createInvitation(gameId: string): Promise<CreateInvitationResponse>;
  revokeInvitations(gameId: string): Promise<RevokeInvitationResponse>;
  getGame(gameId: string): Promise<GameDetails>;
  deleteGame(gameId: string): Promise<DeleteGameResponse>;
  duplicateGame(gameId: string, gameAccessPassword: string): Promise<GameDetails>;
  startGame(gameId: string): Promise<GameDetails>;
  finishGame(gameId: string, input: FinishGameRequest): Promise<GameDetails>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
  createTransaction(gameId: string, request: CreateTransactionRequest, commandId?: string): Promise<CreateBankingCommandResponse>;
  listPaymentRequests(gameId: string): Promise<PaymentRequest[]>;
  acceptPaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse>;
  declinePaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse>;
  cancelPaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse>;
  declareBankruptcy(gameId: string, request: BankruptcyRequest): Promise<BankruptcyResponse>;
  getGameSummary(gameId: string): Promise<{ game: Game; winners: Player[] } & LedgerStatistics>;
  getActivity(gameId: string, scope: ActivityScope, cursor?: string): Promise<ActivityPage>;
  listTransactions(gameId: string, limit?: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit?: number): Promise<Transaction[]>;
  // Boards (catalogue and user copies).
  listBoards(): Promise<BoardSummary[]>;
  getBoard(boardId: string): Promise<BoardDetails>;
  createBoard(request: CreateBoardRequest): Promise<BoardDetails>;
  deleteBoard(boardId: string): Promise<DeleteBoardResponse>;
  // Deeds of a game on a board. Mutations carry a command id like every other banking command.
  getPropertyState(gameId: string): Promise<PropertyStateResponse>;
  purchaseProperty(gameId: string, request: PropertyPurchaseRequest, commandId?: string): Promise<PropertyOperationResponse>;
  /** In `CONFIRMATION` mode a rent claim answers with the pending payment request instead of a transaction. */
  chargeRent(gameId: string, request: PropertyRentRequest, commandId?: string): Promise<PropertyOperationResponse | CreatePaymentRequestResponse>;
  buildHouses(gameId: string, request: PropertyBuildRequest, commandId?: string): Promise<PropertyOperationResponse>;
  sellBuildings(gameId: string, request: PropertySellBuildingsRequest, commandId?: string): Promise<PropertyOperationResponse>;
  mortgageProperty(gameId: string, request: PropertyMortgageRequest, commandId?: string): Promise<PropertyOperationResponse>;
  unmortgageProperty(gameId: string, request: PropertyUnmortgageRequest, commandId?: string): Promise<PropertyOperationResponse>;
  recordAuction(gameId: string, request: PropertyAuctionRequest, commandId?: string): Promise<PropertyOperationResponse>;
  listTrades(gameId: string): Promise<PropertyTrade[]>;
  proposeTrade(gameId: string, request: CreateTradeRequest, commandId?: string): Promise<TradeActionResponse>;
  acceptTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse>;
  declineTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse>;
  cancelTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse>;
  payJailBail(gameId: string, request: JailBailRequest, commandId?: string): Promise<CreateTransactionResponse>;
  recordDiceRoll(gameId: string, request: DiceRollRequest, commandId?: string): Promise<DiceRollResponse>;
}

class FetchMonopolyBankApi implements MonopolyBankApi {
  async currentProfile(): Promise<UserProfile> { return request<UserProfile>('/api/profile'); }
  async register(input: RegisterRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }); }
  async login(input: LoginRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }); }
  async verifyEmail(token: string): Promise<UserProfile> { return request<UserProfile>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }); }
  async requestPasswordReset(email: string): Promise<void> { await request<{ accepted: boolean }>('/api/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }) }); }
  async confirmPasswordReset(token: string, password: string): Promise<void> { await request<null>('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) }); }
  async resendVerification(): Promise<void> { await request<{ accepted: boolean }>('/api/auth/verification-email', { method: 'POST' }); }
  async logout(): Promise<void> { await request<null>('/api/auth/logout', { method: 'POST' }); }
  async updateProfile(input: UpdateProfileRequest): Promise<UserProfile> { return request<UserProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(input) }); }
  async exportAccount(): Promise<AccountExport> { return request<AccountExport>('/api/account/export'); }
  async deleteAccount(): Promise<void> { await request<null>('/api/account', { method: 'DELETE' }); }
  async listGames(): Promise<GameSummary[]> { return request<GameSummary[]>('/api/games'); }
  async createGame(input: CreateGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
  async joinGame(input: JoinGameRequest): Promise<GameDetails> { return request<GameDetails>('/api/games/join', commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async joinGameAsGuest(input: GuestJoinGameRequest): Promise<GuestJoinGameResponse> { return request<GuestJoinGameResponse>('/api/games/join/guest', commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async upgradeGuest(input: UpgradeGuestRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/upgrade', { method: 'POST', body: JSON.stringify(input) }); }
  async addEmailToLegacyAccount(input: AddAccountEmailRequest): Promise<UserProfile> { return request<UserProfile>('/api/auth/email', { method: 'POST', body: JSON.stringify(input) }); }
  async createInvitation(gameId: string): Promise<CreateInvitationResponse> { return request<CreateInvitationResponse>(`/api/games/${encodeURIComponent(gameId)}/invitations`, commandInit({ method: 'POST' })); }
  async revokeInvitations(gameId: string): Promise<RevokeInvitationResponse> { return request<RevokeInvitationResponse>(`/api/games/${encodeURIComponent(gameId)}/invitations`, commandInit({ method: 'DELETE' })); }
  async getGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}`); }
  async deleteGame(gameId: string): Promise<DeleteGameResponse> { return request<DeleteGameResponse>(`/api/games/${encodeURIComponent(gameId)}`, { method: 'DELETE' }); }
  async duplicateGame(gameId: string, gameAccessPassword: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}/duplicate`, { method: 'POST', body: JSON.stringify({ gameAccessPassword }) }); }
  async startGame(gameId: string): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}/start`, commandInit({ method: 'POST' })); }
  async finishGame(gameId: string, input: FinishGameRequest): Promise<GameDetails> { return request<GameDetails>(`/api/games/${encodeURIComponent(gameId)}/finish`, commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> { return request<number[]>(`/api/games/${encodeURIComponent(gameId)}/favorite-amounts`, { method: 'POST', body: JSON.stringify({ amount }) }); }
  async createTransaction(gameId: string, input: CreateTransactionRequest, commandId?: string): Promise<CreateBankingCommandResponse> { return request<CreateBankingCommandResponse>(`/api/games/${encodeURIComponent(gameId)}/transactions`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async listPaymentRequests(gameId: string): Promise<PaymentRequest[]> { return request<PaymentRequest[]>(`/api/games/${encodeURIComponent(gameId)}/payment-requests`); }
  async acceptPaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse> { return request<PaymentRequestActionResponse>(`/api/games/${encodeURIComponent(gameId)}/payment-requests/${encodeURIComponent(paymentRequestId)}/accept`, commandInit({ method: 'POST' }, commandId)); }
  async declinePaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse> { return request<PaymentRequestActionResponse>(`/api/games/${encodeURIComponent(gameId)}/payment-requests/${encodeURIComponent(paymentRequestId)}/decline`, commandInit({ method: 'POST' }, commandId)); }
  async cancelPaymentRequest(gameId: string, paymentRequestId: string, commandId?: string): Promise<PaymentRequestActionResponse> { return request<PaymentRequestActionResponse>(`/api/games/${encodeURIComponent(gameId)}/payment-requests/${encodeURIComponent(paymentRequestId)}/cancel`, commandInit({ method: 'POST' }, commandId)); }
  async declareBankruptcy(gameId: string, input: BankruptcyRequest): Promise<BankruptcyResponse> { return request<BankruptcyResponse>(`/api/games/${encodeURIComponent(gameId)}/bankruptcy`, commandInit({ method: 'POST', body: JSON.stringify(input) })); }
  async getGameSummary(gameId: string): Promise<{ game: Game; winners: Player[] } & LedgerStatistics> { return request<{ game: Game; winners: Player[] } & LedgerStatistics>(`/api/games/${encodeURIComponent(gameId)}/summary`); }
  async getActivity(gameId: string, scope: ActivityScope, cursor?: string): Promise<ActivityPage> { const query = new URLSearchParams({ scope, ...(cursor === undefined ? {} : { cursor }) }); return request<ActivityPage>(`/api/games/${encodeURIComponent(gameId)}/activity?${query}`); }
  async listTransactions(gameId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/transactions?limit=${limit}`); }
  async listPlayerTransactions(gameId: string, playerId: string, limit = 50): Promise<Transaction[]> { return request<Transaction[]>(`/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/transactions?limit=${limit}`); }
  async listBoards(): Promise<BoardSummary[]> { return request<BoardSummary[]>('/api/boards'); }
  async getBoard(boardId: string): Promise<BoardDetails> { return request<BoardDetails>(`/api/boards/${encodeURIComponent(boardId)}`); }
  async createBoard(input: CreateBoardRequest): Promise<BoardDetails> { return request<BoardDetails>('/api/boards', { method: 'POST', body: JSON.stringify(input) }); }
  async deleteBoard(boardId: string): Promise<DeleteBoardResponse> { return request<DeleteBoardResponse>(`/api/boards/${encodeURIComponent(boardId)}`, { method: 'DELETE' }); }
  async getPropertyState(gameId: string): Promise<PropertyStateResponse> { return request<PropertyStateResponse>(`/api/games/${encodeURIComponent(gameId)}/properties`); }
  async purchaseProperty(gameId: string, input: PropertyPurchaseRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/purchase`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async chargeRent(gameId: string, input: PropertyRentRequest, commandId?: string): Promise<PropertyOperationResponse | CreatePaymentRequestResponse> { return request<PropertyOperationResponse | CreatePaymentRequestResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/rent`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async buildHouses(gameId: string, input: PropertyBuildRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/build`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async sellBuildings(gameId: string, input: PropertySellBuildingsRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/sell-buildings`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async mortgageProperty(gameId: string, input: PropertyMortgageRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/mortgage`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async unmortgageProperty(gameId: string, input: PropertyUnmortgageRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/unmortgage`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async recordAuction(gameId: string, input: PropertyAuctionRequest, commandId?: string): Promise<PropertyOperationResponse> { return request<PropertyOperationResponse>(`/api/games/${encodeURIComponent(gameId)}/properties/auction`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async listTrades(gameId: string): Promise<PropertyTrade[]> { return request<PropertyTrade[]>(`/api/games/${encodeURIComponent(gameId)}/trades`); }
  async proposeTrade(gameId: string, input: CreateTradeRequest, commandId?: string): Promise<TradeActionResponse> { return request<TradeActionResponse>(`/api/games/${encodeURIComponent(gameId)}/trades`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async acceptTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse> { return request<TradeActionResponse>(`/api/games/${encodeURIComponent(gameId)}/trades/${encodeURIComponent(tradeId)}/accept`, commandInit({ method: 'POST' }, commandId)); }
  async declineTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse> { return request<TradeActionResponse>(`/api/games/${encodeURIComponent(gameId)}/trades/${encodeURIComponent(tradeId)}/decline`, commandInit({ method: 'POST' }, commandId)); }
  async cancelTrade(gameId: string, tradeId: string, commandId?: string): Promise<TradeActionResponse> { return request<TradeActionResponse>(`/api/games/${encodeURIComponent(gameId)}/trades/${encodeURIComponent(tradeId)}/cancel`, commandInit({ method: 'POST' }, commandId)); }
  async payJailBail(gameId: string, input: JailBailRequest, commandId?: string): Promise<CreateTransactionResponse> { return request<CreateTransactionResponse>(`/api/games/${encodeURIComponent(gameId)}/jail/bail`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
  async recordDiceRoll(gameId: string, input: DiceRollRequest, commandId?: string): Promise<DiceRollResponse> { return request<DiceRollResponse>(`/api/games/${encodeURIComponent(gameId)}/dice-rolls`, commandInit({ method: 'POST', body: JSON.stringify(input) }, commandId)); }
}

function commandInit(init: RequestInit, commandId: string = crypto.randomUUID()): RequestInit { return { ...init, headers: { ...init.headers, 'x-command-id': commandId } }; }

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
