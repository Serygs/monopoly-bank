import type { Currency, Game, PaymentMode, Player, Transaction, TransactionType } from '../types/monopoly.js';

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface GameSummary {
  game: Game;
  playerCount: number;
  /** Public lobbies can be joined without a table password. */
  isPublicLobby?: boolean;
  /** Exposed only for public lobbies; private invitation codes remain owner-only. */
  joinCode?: string;
}

export interface GameDetails {
  game: Game;
  players: Player[];
  favoriteAmounts?: number[];
  recentAmounts?: number[];
  /** Wallets the current actor can operate. All other wallets are read-only. */
  controlledPlayerIds?: string[];
  controlledWallets?: PlayerController[];
  canManage?: boolean;
  /** Present only for the game's owner; never expose the password hash. */
  joinCode?: string;
}

export type PlayerControllerKind = 'PRIMARY' | 'LOCAL';
export interface PlayerController { playerId: string; kind: PlayerControllerKind; }

export interface DeleteGameResponse {
  gameId: string;
}

export interface CreateGameRequest {
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  paymentMode?: PaymentMode;
  gameAccessPassword?: string;
  players: CreateGamePlayerRequest[];
}

export type AccountType = 'REGISTERED' | 'GUEST';
export interface RegisterRequest { nickname: string; avatar: string; email: string; password: string; }
/** `nickname` remains available only for pre-email accounts created before migration 0012. */
export type LoginRequest = { email: string; password: string } | { nickname: string; password: string };
export type GuestJoinGameRequest = { nickname: string; avatar: string } & JoinGameRequest;
export interface GuestJoinGameResponse { profile: UserProfile; game: GameDetails; }
export interface UpgradeGuestRequest { email: string; password: string; }
export interface AddAccountEmailRequest { email: string; }
export interface AuthTokenRequest { token: string; }
export interface PasswordResetRequest { email: string; }
export interface PasswordResetConfirmationRequest { token: string; password: string; }
export interface UpdateProfileRequest { nickname: string; avatar: string; }
export type JoinGameRequest =
  | { joinCode: string; gameAccessPassword?: string }
  | { invitationToken: string };
export type InvitationVisibility = 'UNLISTED';
/** The token is returned only when an invitation is created or rotated. */
export interface CreateInvitationResponse {
  invitationToken: string;
  shortCode: string;
  expiresAt: string;
  visibility: InvitationVisibility;
}
export interface RevokeInvitationResponse { revoked: boolean; }
export interface DuplicateGameRequest { gameAccessPassword: string; }
export interface UserProfile { id: string; nickname: string; avatar: string; accountType: AccountType; email: string | null; emailVerified: boolean; gamesPlayed: number; gamesWon: number; gamesLost: number; winRate: number; createdAt: string; updatedAt: string; }
export interface AccountExport { exportedAt: string; profile: Pick<UserProfile, 'id' | 'nickname' | 'avatar' | 'accountType' | 'email' | 'emailVerified' | 'createdAt' | 'updatedAt'>; memberships: Array<{ gameId: string; gameName: string; gameStatus: string; role: 'OWNER' | 'PLAYER'; playerId: string | null }>; }

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
export interface FinishGameRequest { winnerPlayerIds: string[]; }
export type ActivityScope = 'ALL' | 'MINE' | 'PENDING';
export interface ActivityCursor { createdAt: string; id: string; }
export interface ActivityPage { transactions: Transaction[]; paymentRequests: PaymentRequest[]; nextCursor: ActivityCursor | null; }
export interface CashLeaderboardEntry { player: Player; sent: number; received: number; passGoCount: number; transactionCount: number; }
export interface LedgerStatistics extends FinalGameSummaryResponse { cashLeaderboard: CashLeaderboardEntry[]; }

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

export const paymentRequestStates = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const;
export type PaymentRequestState = (typeof paymentRequestStates)[number];
export interface PaymentRequest {
  id: string;
  gameId: string;
  payerPlayerId: string;
  recipientPlayerId: string;
  creatorPlayerId: string;
  approverPlayerId: string;
  amount: number;
  comment: string | null;
  state: PaymentRequestState;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  transactionId: string | null;
}
export interface CreatePaymentRequestResponse { paymentRequests: PaymentRequest[]; players: Player[]; }
export type CreateBankingCommandResponse = CreateTransactionResponse | CreatePaymentRequestResponse;
export interface PaymentRequestActionResponse { paymentRequest: PaymentRequest; players: Player[]; transaction?: Transaction; }
