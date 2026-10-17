import type { BoardMode } from '../board/index.js';
import type {
  Game,
  GameProperty,
  GameRules,
  BankLoanCooldown,
  InterestRatePercent,
  Auction,
  Loan,
  Mortgage,
  PaymentMode,
  Player,
  SelectableCurrency,
  Transaction,
  TransactionType,
} from '../types/monopoly.js';

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
  /** Exposed only for public lobbies; the code of a private game stays owner-only. */
  joinCode?: string;
}

/** How long a removed game stays restorable before the scheduled cleanup deletes it. */
export const DELETED_GAME_RETENTION_DAYS = 30;

/** A removed game in the owner's "Deleted" list; it is stored (and shown) as finished. */
export interface DeletedGameSummary extends GameSummary {
  deletedAt: string;
  /** When the scheduled cleanup removes the game for good unless it is restored first. */
  purgeAt: string;
}

export interface GameDetails {
  game: Game;
  players: Player[];
  /** The property registry, one row per tile; present only for games with a board. */
  properties?: GameProperty[];
  /** Properties currently mortgaged to the bank. */
  mortgages?: Mortgage[];
  /** Loans that are still being repaid (player loans; the bank's later). */
  loans?: Loan[];
  /** Players still in the cooldown after repaying a bank loan (bank-loans rule only). */
  bankLoanCooldowns?: BankLoanCooldown[];
  /** The Free Parking pot; present only when the game has the jackpot rule. */
  jackpot?: number;
  /**
   * With the auctions rule: the active auction, or the one that closed most recently (so every
   * device sees the result), or null.
   */
  auction?: Auction | null;
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
export interface PlayerController {
  playerId: string;
  kind: PlayerControllerKind;
}

export interface DeleteGameResponse {
  gameId: string;
}

export type RestoreGameResponse = DeleteGameResponse;

export interface CreateGameRequest {
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: SelectableCurrency;
  paymentMode?: PaymentMode;
  /** Optional house rules; omitted rules are off. Fixed once the game is created. */
  rules?: GameRules;
  /** Board mode, fixed at creation. Omitted means 'none' (manual mortgages and auctions). */
  board?: BoardMode;
  /** A public lobby is listed for every signed-in user and has no password. Default: private. */
  isPublic?: boolean;
  gameAccessPassword?: string;
  players: CreateGamePlayerRequest[];
}

export type AccountType = 'REGISTERED' | 'GUEST';
export interface RegisterRequest {
  nickname: string;
  avatar: string;
  password: string;
}
/** `email` remains available only for accounts that added one via the (currently disabled) email-upgrade flow. */
export type LoginRequest =
  { email: string; password: string } | { nickname: string; password: string };
export type GuestJoinGameRequest = { nickname: string; avatar: string } & JoinGameRequest;
export interface GuestJoinGameResponse {
  profile: UserProfile;
  game: GameDetails;
}
export interface UpgradeGuestRequest {
  email: string;
  password: string;
}
export interface AddAccountEmailRequest {
  email: string;
}
export interface AuthTokenRequest {
  token: string;
}
export interface PasswordResetRequest {
  email: string;
}
export interface PasswordResetConfirmationRequest {
  token: string;
  password: string;
}
export interface UpdateProfileRequest {
  nickname: string;
  avatar: string;
}
/** A lobby seats at most this many players. */
export const MAX_LOBBY_PLAYERS = 6;
export type JoinGameRequest =
  { joinCode: string; gameAccessPassword?: string } | { invitationToken: string };
export type InvitationVisibility = 'UNLISTED';
/** The token is returned only when an invitation is created or rotated. */
export interface CreateInvitationResponse {
  invitationToken: string;
  shortCode: string;
  expiresAt: string;
  visibility: InvitationVisibility;
}
export interface RevokeInvitationResponse {
  revoked: boolean;
}
export interface DuplicateGameRequest {
  gameAccessPassword: string;
}
export interface UserProfile {
  id: string;
  nickname: string;
  avatar: string;
  accountType: AccountType;
  email: string | null;
  emailVerified: boolean;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number;
  createdAt: string;
  updatedAt: string;
}
export interface AccountExport {
  exportedAt: string;
  profile: Pick<
    UserProfile,
    | 'id'
    | 'nickname'
    | 'avatar'
    | 'accountType'
    | 'email'
    | 'emailVerified'
    | 'createdAt'
    | 'updatedAt'
  >;
  memberships: Array<{
    gameId: string;
    gameName: string;
    gameStatus: string;
    role: 'OWNER' | 'PLAYER';
    playerId: string | null;
  }>;
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
  /** The player landed exactly on GO; pays double when the game enables that rule. */
  exactLanding?: boolean;
}

/** A player mortgages a property to the bank for the value printed on its card. */
export interface MortgageTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'MORTGAGE';
  playerId: string;
  propertyName: string;
  /** The mortgage value; the bank pays this amount. */
  amount: number;
}

/** Board games: mortgages a tile the player owns; the bank pays the snapshot's mortgage value. */
export interface TileMortgageTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'MORTGAGE';
  playerId: string;
  tileId: string;
}

/** Board games: buys an unowned tile from the bank at the snapshot price (or `priceOverride`). */
export interface PropertyPurchaseTransactionRequest extends Omit<
  TransactionRequestBase,
  'comment'
> {
  type: 'PROPERTY_PURCHASE';
  playerId: string;
  tileId: string;
  /**
   * Pays this price instead of the list price (an agreed deal). The review screen asks for an
   * extra confirmation and the ledger marks the purchase as overridden.
   */
  priceOverride?: number;
}

/** Board games: the owner adds a house (or the hotel) to a street; the bank is paid one house cost. */
export interface PropertyBuildTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'PROPERTY_BUILD';
  playerId: string;
  tileId: string;
}

/** Board games: the owner sells a building back; the bank pays half the house cost. */
export interface PropertySellBuildingTransactionRequest extends Omit<
  TransactionRequestBase,
  'comment'
> {
  type: 'PROPERTY_SELL_BUILDING';
  playerId: string;
  tileId: string;
}

/**
 * Board games: the payer pays the tile's owner the rent the server works out from the registry.
 * `diceSum` is required for a utility (entered by the payer) and rejected otherwise.
 */
export interface PayRentTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'PAY_RENT';
  payerPlayerId: string;
  tileId: string;
  diceSum?: number;
}

/** Redeems one active mortgage; the cost is the mortgage value plus 10%, worked out server-side. */
export interface RedeemMortgageTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'MORTGAGE_REDEMPTION';
  playerId: string;
  mortgageId: string;
}

/**
 * Asks another player for a loan. It never moves money by itself: it creates a pending payment
 * request (kind LOAN) that the lender must accept, whatever the game's payment mode. Requires the
 * player-loans rule.
 */
export interface LoanIssueTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'LOAN_ISSUE';
  /** Absent or PLAYER; a bank loan is a BankLoanTransactionRequest. */
  lenderKind?: 'PLAYER';
  /** The player asking for the money (the wallet whose controller sends this). */
  borrowerPlayerId: string;
  lenderPlayerId: string;
  amount: number;
}

/** The borrower repays part or all of what is still owed on one loan; the lender receives it. */
export interface LoanRepaymentTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'LOAN_REPAYMENT';
  /** The borrower. */
  playerId: string;
  loanId: string;
  /** At most the outstanding amount. A bank loan is repaid in full: this must equal its principal. */
  amount: number;
  /**
   * Bank loans only (required there, rejected for player loans): the rate the player confirmed,
   * normally the suggested one. Interest = principal * rate, rounded half up, and leaves the game.
   */
  interestRatePercent?: InterestRatePercent;
}

/**
 * Borrows from the bank (bank-loans rule): paid out at once as a LOAN_ISSUE transaction, at most
 * `settings.bankLoanMax`, one active bank loan per player.
 */
export interface BankLoanTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'LOAN_ISSUE';
  lenderKind: 'BANK';
  /** The borrower. */
  playerId: string;
  amount: number;
  /** Required (true) when the player is in a bank-loan cooldown; stored on the loan. */
  acknowledgeCooldown?: boolean;
}

/**
 * Pays a tax into the Free Parking pot instead of the bank (jackpot rule). The client sends this
 * for the income-tax and luxury-tax chips; every other bank payment stays PLAYER_TO_BANK.
 */
export interface ToJackpotTransactionRequest extends TransactionRequestBase {
  type: 'TO_JACKPOT';
  playerId: string;
  amount: number;
}

/** The player landed on Free Parking and collects the whole pot. */
export interface JackpotPayoutTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'JACKPOT_PAYOUT';
  playerId: string;
  /**
   * The pot the player reviewed. If the pot differs when the command runs, nothing is written and
   * the request fails with JACKPOT_CHANGED (or JACKPOT_EMPTY), so the player never receives an
   * amount they did not confirm.
   */
  expectedAmount: number;
}

/** Puts a property up for auction (auctions rule). Only one auction can run at a time. */
export interface StartAuctionRequest {
  /** The player who offered the property (a wallet the actor controls). */
  initiatorPlayerId: string;
  /** Free-text name, up to 60 characters. */
  lotName: string;
  /** Board games: the unowned tile put up for sale; the server takes the lot name from it. */
  tileId?: string;
}

/**
 * A bid is made with a button: the new bid is the current bid plus `step` units (first bid: that
 * many units, at least the minimum bid). Valid steps are in `game.settings.auctionBidSteps`.
 */
export interface PlaceBidRequest {
  /** The wallet that bids (a wallet the actor controls). */
  bidderPlayerId: string;
  auctionId: string;
  /** The auction version the bidder saw; a stale bid is refused with AUCTION_BID_STALE. */
  expectedVersion: number;
  /** One of the game's `auctionBidSteps` amounts (money, not units). */
  step: number;
}

export interface AuctionResponse {
  auction: Auction | null;
  /** Present when this call settled an auction into an AUCTION_PAYMENT. */
  transaction?: Transaction;
  players?: Player[];
}

/** Corrects a mistaken transaction with a new REVERSAL record; the original is never edited. */
export interface ReversalTransactionRequest extends TransactionRequestBase {
  type: 'REVERSAL';
  transactionId: string;
}

export interface BankruptcyRequest {
  playerId: string;
  creditorPlayerId?: string;
}

export interface SetJailRequest {
  isInJail: boolean;
}
export interface DiceRollRequest {
  playerId: string;
  first: number;
  second: number;
}
export interface DiceRollResponse {
  player: Player;
  thirdDouble: boolean;
}
export interface GameSummaryStatistics {
  durationMs: number;
  totalTransactions: number;
  totalMoneyTransferred: number;
  largestSinglePayment: number;
  richestActivePlayer: Player | null;
  lowestActiveBalance: number | null;
  players: Array<{
    player: Player;
    totalReceived: number;
    totalPaid: number;
    passGoCount: number;
    transactionCount: number;
  }>;
}
export interface FinalGameSummaryResponse extends GameSummaryStatistics {
  playerToPlayerTotal: number;
  paidToBank: number;
  receivedFromBank: number;
  largestTransaction: number;
  biggestSenderId: string | null;
  leastSenderId: string | null;
  biggestPayerRecipient: {
    payerId: string;
    recipientId: string;
    amount: number;
    transactionCount: number;
  } | null;
}
export interface FinishGameRequest {
  winnerPlayerIds: string[];
}
export type ActivityScope = 'ALL' | 'MINE' | 'PENDING';
export interface ActivityCursor {
  createdAt: string;
  id: string;
}
export interface ActivityPage {
  transactions: Transaction[];
  paymentRequests: PaymentRequest[];
  nextCursor: ActivityCursor | null;
}
export interface CashLeaderboardEntry {
  player: Player;
  sent: number;
  received: number;
  passGoCount: number;
  transactionCount: number;
}
/** One award card: the player, the amount and, for an auction, the lot. */
export interface StatisticsAward {
  playerId: string;
  amount: number;
  label?: string | null;
}
/** Derived from the ledger on read; absent from snapshots saved before awards existed. */
export interface GameAwards {
  biggestOperation: {
    type: TransactionType;
    amount: number;
    playerId: string | null;
  } | null;
  rentPaid: StatisticsAward | null;
  rentCollected: StatisticsAward | null;
  bestAuctionDeal: StatisticsAward | null;
  biggestLoan: StatisticsAward | null;
}
/** `steps` counted transactions; `balances` hold up to 61 evenly spaced points, first and last included. */
export interface BalanceSeries {
  steps: number;
  players: Array<{ playerId: string; balances: number[] }>;
}
export interface LedgerStatistics extends FinalGameSummaryResponse {
  cashLeaderboard: CashLeaderboardEntry[];
  awards?: GameAwards;
  balanceSeries?: BalanceSeries;
}

export type CreateTransactionRequest =
  | PlayerToPlayerTransactionRequest
  | PlayerToBankTransactionRequest
  | BankToPlayerTransactionRequest
  | PlayerToAllTransactionRequest
  | AllToPlayerTransactionRequest
  | PassGoTransactionRequest
  | MortgageTransactionRequest
  | TileMortgageTransactionRequest
  | PropertyPurchaseTransactionRequest
  | PropertyBuildTransactionRequest
  | PropertySellBuildingTransactionRequest
  | PayRentTransactionRequest
  | RedeemMortgageTransactionRequest
  | LoanIssueTransactionRequest
  | LoanRepaymentTransactionRequest
  | BankLoanTransactionRequest
  | ToJackpotTransactionRequest
  | JackpotPayoutTransactionRequest
  | ReversalTransactionRequest;

/** Every request that names its own wallet; a reversal is authorized from the stored record instead. */
export type PlayerTransactionRequest = Exclude<
  CreateTransactionRequest,
  ReversalTransactionRequest
>;

export interface CreateTransactionResponse {
  transaction: Transaction;
  players: Player[];
  /** The active mortgages after a mortgage, a redemption or a bankruptcy; absent for every other operation. */
  mortgages?: Mortgage[];
  /** The loans still being repaid after a repayment or a bankruptcy; absent for every other operation. */
  loans?: Loan[];
  /** With the bank-loans rule every response carries these, since every operation can advance a round. */
  bankLoanCooldowns?: BankLoanCooldown[];
  /** The Free Parking pot after this operation; present whenever the game has the jackpot rule. */
  jackpot?: number;
  /** Board games: the registry rows this operation changed. */
  properties?: GameProperty[];
}

export const paymentRequestStates = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PaymentRequestState = (typeof paymentRequestStates)[number];
export type PaymentRequestKind = 'PAYMENT' | 'LOAN';
export interface PaymentRequest {
  id: string;
  /** A LOAN request, once accepted, issues a loan instead of an ordinary payment. */
  kind: PaymentRequestKind;
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
export interface CreatePaymentRequestResponse {
  paymentRequests: PaymentRequest[];
  players: Player[];
}
export type CreateBankingCommandResponse = CreateTransactionResponse | CreatePaymentRequestResponse;
export interface PaymentRequestActionResponse {
  paymentRequest: PaymentRequest;
  players: Player[];
  transaction?: Transaction;
  /** The loans still being repaid after accepting a loan request. */
  loans?: Loan[];
  /** With the bank-loans rule every response carries these, since every operation can advance a round. */
  bankLoanCooldowns?: BankLoanCooldown[];
  /** The Free Parking pot after this operation; present whenever the game has the jackpot rule. */
  jackpot?: number;
  /** Board games: the registry rows this operation changed. */
  properties?: GameProperty[];
}

/** One roll of the two table dice by one player; kept only while the game is active. */
export interface DiceRoll {
  id: string;
  playerId: string;
  dieOne: number;
  dieTwo: number;
  createdAt: string;
}
export interface RecordDiceRollRequest {
  /** Client-generated UUID that makes a retried request idempotent. */
  id: string;
  dieOne: number;
  dieTwo: number;
}
