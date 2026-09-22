import type { BoardDefinition, BoardSpace, BuildingBank, Game, GameProperty, PaymentMode, Player, SelectableCurrency, Transaction, TransactionType } from '../types/monopoly.js';
import type { MortgageResolution } from '../domain/property-trade.js';

/** The rule lives in the domain; the wire shape re-exports it so clients import one name. */
export type { MortgageResolution };

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
  /** The four board fields are present only for a game that opted into a board; a game without one omits them all. */
  board?: BoardDefinition;
  boardSpaces?: BoardSpace[];
  properties?: GameProperty[];
  buildingBank?: BuildingBank;
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
  currency: SelectableCurrency;
  paymentMode?: PaymentMode;
  gameAccessPassword?: string;
  players: CreateGamePlayerRequest[];
  /** Opt the game into a board: a canonical one, or a copy the creator owns. */
  boardId?: string;
}

/** A board as the catalogue lists it; `isCanonical` boards belong to nobody and are shared by every table. */
export interface BoardSummary {
  board: BoardDefinition;
  isCanonical: boolean;
  sourceBoardId: string | null;
  createdAt: string;
}

export interface BoardDetails extends BoardSummary {
  spaces: BoardSpace[];
}

/** Renames every space of `sourceBoardId` into a new board the caller owns; prices, groups and rents are copied verbatim. */
export interface CreateBoardRequest {
  name: string;
  sourceBoardId: string;
  /** Exactly one custom name per space of the source board, keyed by the source space id. */
  spaceNames: Record<string, string>;
}

export interface DeleteBoardResponse { boardId: string; }

export type AccountType = 'REGISTERED' | 'GUEST';
export interface RegisterRequest { nickname: string; avatar: string; password: string; }
/** `email` remains available only for accounts that added one via the (currently disabled) email-upgrade flow. */
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
  /** Set only for a rent confirmation, which is repriced against the deed when it is accepted. */
  boardSpaceId?: string | null;
}
interface PropertyRequestBase {
  boardSpaceId: string;
  comment?: string;
}

export interface PropertyPurchaseRequest extends PropertyRequestBase { playerId: string; }
/**
 * `diceTotal` is required only for a utility, whose rent is the dice total times
 * the board multiplier. `chargedByOwner` says the owner is the one claiming the
 * rent, which is what decides whose controller must authorize it — the request
 * deliberately cannot name that owner, because the owner of a space is whatever
 * the stored deed says. See `rentBankingCommand` in `shared/domain/player-control.ts`.
 */
export interface PropertyRentRequest extends PropertyRequestBase { payerPlayerId: string; chargedByOwner?: boolean; diceTotal?: number; }
export interface PropertyBuildRequest extends PropertyRequestBase { playerId: string; count: number; }
export interface PropertySellBuildingsRequest extends PropertyRequestBase { playerId: string; count: number; }
export interface PropertyMortgageRequest extends PropertyRequestBase { playerId: string; }
export interface PropertyUnmortgageRequest extends PropertyRequestBase { playerId: string; }
/** The winning bid is whatever the table agreed, so it is not bounded by the catalogue price. */
export interface PropertyAuctionRequest extends PropertyRequestBase { winnerPlayerId: string; price: number; }
export interface JailBailRequest { playerId: string; comment?: string; }

export const propertyTradeStates = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const;
export type PropertyTradeState = (typeof propertyTradeStates)[number];

/** One deed moving in a trade. `mortgageResolution` stays null unless the deed is mortgaged. */
export interface PropertyTradeItem {
  boardSpaceId: string;
  fromPlayerId: string;
  mortgageResolution: MortgageResolution | null;
}

export interface PropertyTrade {
  id: string;
  gameId: string;
  proposerPlayerId: string;
  responderPlayerId: string;
  cashFromProposer: number;
  cashFromResponder: number;
  items: PropertyTradeItem[];
  state: PropertyTradeState;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  transactionId: string | null;
}

export interface TradeOffer {
  boardSpaceId: string;
  mortgageResolution?: MortgageResolution;
}

export interface CreateTradeRequest {
  proposerPlayerId: string;
  responderPlayerId: string;
  cashFromProposer?: number;
  cashFromResponder?: number;
  propertiesFromProposer?: TradeOffer[];
  propertiesFromResponder?: TradeOffer[];
  comment?: string;
}

/**
 * Every trade action answers with the trade itself. The settling transaction and
 * the board slice appear only on acceptance, which is the one action that moves
 * money and deeds.
 */
export interface TradeActionResponse {
  trade: PropertyTrade;
  players: Player[];
  transaction?: Transaction;
  properties?: GameProperty[];
  buildingBank?: BuildingBank;
}

/** The board slice a client needs to render ownership: the catalogue, who owns what, and what the bank still holds. */
export interface PropertyStateResponse {
  board: BoardDefinition;
  boardSpaces: BoardSpace[];
  properties: GameProperty[];
  buildingBank: BuildingBank;
}

export interface PropertyOperationResponse {
  transaction: Transaction;
  players: Player[];
  properties: GameProperty[];
  buildingBank: BuildingBank;
}

export interface CreatePaymentRequestResponse { paymentRequests: PaymentRequest[]; players: Player[]; }
export type CreateBankingCommandResponse = CreateTransactionResponse | CreatePaymentRequestResponse;
export interface PaymentRequestActionResponse { paymentRequest: PaymentRequest; players: Player[]; transaction?: Transaction; }
