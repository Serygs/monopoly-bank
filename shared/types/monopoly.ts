export const gameStatuses = ['LOBBY', 'ACTIVE', 'FINISHED'] as const;

export type GameStatus = (typeof gameStatuses)[number];

/** Currencies a new game can be created with. */
export const selectableCurrencies = ['USD', 'EUR', 'UAH'] as const;
export type SelectableCurrency = (typeof selectableCurrencies)[number];

/** Every currency a stored game may carry. `K` is legacy: existing games keep it, new games cannot choose it. */
export const currencies = [...selectableCurrencies, 'K'] as const;
export type Currency = (typeof currencies)[number];

export const paymentModes = ['FAST', 'CONFIRMATION'] as const;
export type PaymentMode = (typeof paymentModes)[number];

/** Optional house rules, chosen with the lobby and fixed once it exists. All are off by default. */
export const gameRuleKeys = [
  'doubleRewardOnExactGo',
  'playerLoans',
  'bankLoans',
  'freeParkingJackpot',
  'auctions',
] as const;
export type GameRuleKey = (typeof gameRuleKeys)[number];
export type GameRules = Record<GameRuleKey, boolean>;

export const defaultGameRules: GameRules = {
  doubleRewardOnExactGo: false,
  playerLoans: false,
  bankLoans: false,
  freeParkingJackpot: false,
  auctions: false,
};

/**
 * Amounts derived once from the starting balance when the game is created, in whole currency
 * units. Games created before the snapshot existed have none.
 */
export interface GameSettings {
  /** The money unit: the starting balance divided by 150, rounded to a 1-2-5 value (minimum 10). */
  unit: number;
  incomeTax: number;
  luxuryTax: number;
  jailFine: number;
  bankLoanMax: number;
  auctionMinBid: number;
  /** The auction bid buttons: 1, 2.5, 5 and 10 units. */
  auctionBidSteps: number[];
}

export const transactionTypes = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PAY_RENT',
  'PASS_GO',
  'BANKRUPTCY_TRANSFER',
  'REVERSAL',
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
  'LOAN_ISSUE',
  'LOAN_REPAYMENT',
] as const;

export type TransactionType = (typeof transactionTypes)[number];

export interface Game {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  /** Set at lobby creation and immutable once the game starts. */
  paymentMode: PaymentMode;
  rules: GameRules;
  settings: GameSettings | null;
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
  /** Set when this wallet belongs to a registered Monopoly Bank account. */
  userId?: string | null;
  createdAt: string;
}

export const playerStatuses = ['ACTIVE', 'BANKRUPT'] as const;
export type PlayerStatus = (typeof playerStatuses)[number];

/**
 * A property a player mortgaged to the bank. Only the free-text name and the value the player
 * entered from the property card are stored; the game does not know about ownership.
 */
export interface Mortgage {
  /** The id of the MORTGAGE transaction that created it. */
  id: string;
  gameId: string;
  playerId: string;
  propertyName: string;
  /** What the bank paid out; redeeming costs this plus 10%. */
  mortgageValue: number;
  createdAt: string;
}

export const loanStates = ['ACTIVE', 'REPAID', 'WRITTEN_OFF'] as const;
export type LoanState = (typeof loanStates)[number];
export type LoanLenderKind = 'PLAYER' | 'BANK';

/**
 * Money one player lent another (or, later, the bank lent a player). It records only the debt;
 * the cash moved by explicit LOAN_ISSUE / LOAN_REPAYMENT transactions.
 */
export interface Loan {
  /** The id of the LOAN_ISSUE transaction that created it. */
  id: string;
  gameId: string;
  lenderKind: LoanLenderKind;
  /** Null when the bank is the lender. */
  lenderPlayerId: string | null;
  borrowerPlayerId: string;
  principal: number;
  /** Repaid so far; outstanding = principal - repaidAmount. */
  repaidAmount: number;
  state: LoanState;
  createdAt: string;
  closedAt: string | null;
  /** A bank loan taken during the cooldown after repaying the previous one, after the warning. */
  cooldownAcknowledged?: boolean;
  /** Only for an ACTIVE bank loan: derived from the operation log on read, never stored. */
  rounds?: LoanRoundStatus;
}

/** Bank-loan interest is charged on the principal, without compounding. */
export const interestRatePercents = [0, 10, 20] as const;
export type InterestRatePercent = (typeof interestRatePercents)[number];

/**
 * Where a bank loan stands, inferred from whose operations followed it (see
 * shared/domain/round-tracking.ts). The app never stores or enforces turn order; this is a hint.
 */
export interface LoanRoundStatus {
  /** 1 while the borrower is still in the turn they borrowed in, 2 after their next turn starts, ... */
  round: number;
  /** 0% in round 1, 10% in round 2, 20% from round 3. */
  suggestedRatePercent: InterestRatePercent;
  /** The loan reached round 4 without being repaid. */
  overdue: boolean;
}

/** A player who repaid a bank loan recently; borrowing again now needs a confirmed warning. */
export interface BankLoanCooldown {
  playerId: string;
  /** Rounds until a new bank loan no longer needs the warning (1 or 2). */
  roundsLeft: number;
}

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
  /** Set on a REVERSAL: the transaction it moved back. */
  reversesTransactionId?: string | null;
  /** Set on a reversed transaction: the REVERSAL that moved it back. */
  reversedByTransactionId?: string | null;
}
