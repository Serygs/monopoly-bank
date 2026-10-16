import type {
  BankLoanCooldown,
  Game,
  InterestRatePercent,
  Loan,
  LoanLenderKind,
  Mortgage,
  Player,
  PropertyChange,
  Transaction,
  TransactionParticipant,
  TransactionType,
} from '../types/monopoly.js';
import { bankLoanInterest } from './bank-loan.js';
import { buildGameSettings } from './game-rules.js';
import { normalizePropertyName, redemptionCost } from './mortgage.js';
import {
  assertCanMortgage,
  DiceSumError,
  invertChanges,
  mortgageChange,
  ownerChange,
  PropertyAlreadyOwnedError,
  PropertyMortgagedError,
  PropertyNotOwnedError,
  purchasePrice,
  rentFor,
  requireTile,
  stateOf,
  type PropertyContext,
} from './property.js';
import { findReversalDependency, isReversibleType } from './reversal.js';
import { AppError } from '../../worker/services/errors.js';

export interface PlayerToPlayerCommand extends BankingCommand {
  sourcePlayerId: string;
  destinationPlayerId: string;
  amount: number;
}

export interface PlayerToBankCommand extends BankingCommand {
  playerId: string;
  amount: number;
}

export interface BankToPlayerCommand extends BankingCommand {
  playerId: string;
  amount: number;
}

export interface PlayerToAllCommand extends BankingCommand {
  payerPlayerId: string;
  amountPerPlayer: number;
}

export interface AllToPlayerCommand extends BankingCommand {
  recipientPlayerId: string;
  amountPerPlayer: number;
}

export interface PassGoCommand {
  game: Game;
  players: readonly Player[];
  playerId: string;
  /** Landed exactly on GO: pays double. The caller checks that the game enables the rule. */
  exactLanding?: boolean;
  comment?: string | null;
}

export interface ToJackpotCommand extends BankingCommand {
  playerId: string;
  amount: number;
}

export interface JackpotPayoutCommand {
  game: Game;
  players: readonly Player[];
  playerId: string;
  /** The pot as the server just read it; the whole of it is paid out. */
  jackpot: number;
  /** The pot the player reviewed; a different pot is refused before anything is written. */
  expectedAmount: number;
}

export interface AuctionPaymentCommand {
  game: Game;
  players: readonly Player[];
  /** The winning bidder. */
  playerId: string;
  /** The winning bid. */
  amount: number;
  /** The lot name, kept as the transaction's comment. */
  lotName: string;
  /** Board games: the tile sold; it must still be unowned and passes to the winner. */
  tileId?: string | null;
  property?: PropertyContext;
}

export interface MortgageTileCommand extends BankingCommand {
  playerId: string;
  tileId: string;
  property: PropertyContext;
}

export interface PropertyPurchaseCommand extends BankingCommand {
  playerId: string;
  tileId: string;
  property: PropertyContext;
}

export interface PayRentCommand extends BankingCommand {
  payerPlayerId: string;
  tileId: string;
  /** Required for a utility, rejected for any other tile. */
  diceSum?: number;
  property: PropertyContext;
}

export interface MortgagePropertyCommand extends BankingCommand {
  playerId: string;
  propertyName: string;
  /** The mortgage value from the property card; the bank pays this. */
  amount: number;
}

export interface RedeemMortgageCommand extends BankingCommand {
  playerId: string;
  /** The active mortgage being redeemed. */
  mortgage: Mortgage;
  /** Required when the mortgage is on a board tile. */
  property?: PropertyContext;
}

export interface IssueLoanCommand {
  game: Game;
  players: readonly Player[];
  lenderPlayerId: string;
  borrowerPlayerId: string;
  amount: number;
}

export interface RepayLoanCommand {
  game: Game;
  players: readonly Player[];
  /** The borrower. */
  playerId: string;
  /** The active loan being repaid. */
  loan: Loan;
  amount: number;
}

export interface IssueBankLoanCommand {
  game: Game;
  players: readonly Player[];
  /** The borrower. */
  playerId: string;
  amount: number;
  /** The borrower's ACTIVE bank loan, if any; a second one is refused. */
  activeBankLoan?: Loan | null;
  /** Set while the borrower is in the cooldown after repaying their previous bank loan. */
  cooldown?: BankLoanCooldown | null;
  /** The player confirmed the cooldown warning. */
  acknowledgeCooldown?: boolean;
}

export interface RepayBankLoanCommand {
  game: Game;
  players: readonly Player[];
  /** The borrower. */
  playerId: string;
  /** The active bank loan; it is repaid in full. */
  loan: Loan;
  amount: number;
  /** The rate the player confirmed. */
  interestRatePercent: InterestRatePercent;
  /** The rate the round tracking suggests right now. */
  suggestedRatePercent: InterestRatePercent;
}

export interface ReversalCommand {
  game: Game;
  players: readonly Player[];
  /** The stored transaction to move back, with its participants. */
  original: Transaction;
  /** Every transaction written after `original`; one that builds on it blocks the reversal. */
  later?: readonly Transaction[];
  /** The registry changes stored with `original` (read from property_changes), if any. */
  originalRegistryChanges?: readonly PropertyChange[];
  comment?: string | null;
}

export interface BankruptcyCommand extends BankingCommand {
  playerId: string;
  creditorPlayerId?: string;
  /**
   * The bankrupt player's ACTIVE bank loan, if any. The bank is paid first, at the rate the round
   * tracking suggests right now, before anything goes to a player creditor.
   */
  bankLoan?: { loan: Loan; suggestedRatePercent: InterestRatePercent };
  /** Board games: the registry, so the bankrupt player's tiles go to the creditor or the bank. */
  property?: PropertyContext;
}

interface BankingCommand {
  game: Game;
  players: readonly Player[];
  comment?: string | null;
}

export interface BankingOperationResult {
  transaction: PendingTransaction;
  affectedPlayers: PlayerBalanceChange[];
}

export interface PendingTransaction {
  gameId: string;
  type: TransactionType;
  amount: number;
  totalAmount: number;
  comment: string | null;
  participants: TransactionParticipant[];
  /** Set only on a REVERSAL: the stored transaction it moves back. */
  reversesTransactionId?: string;
  /**
   * Set only on a TO_JACKPOT or JACKPOT_PAYOUT: how the Free Parking pot changes, written in the
   * same batch as the transaction. A payout is guarded by the pot it read (`expected`), so a pot
   * that changed in between rolls the whole batch back.
   */
  jackpot?: { kind: 'DEPOSIT'; amount: number } | { kind: 'COLLECT'; expected: number };
  /** Set only on an AUCTION_PAYMENT: the auction it closes, written in the same batch. */
  settlesAuction?: { auctionId: string; expectedVersion: number };
  /** The board tile this operation concerned (purchase, mortgage, redemption, auction, rent). */
  tileId?: string;
  /**
   * Board games: how the property registry changes, written in the same batch. Each change is
   * guarded by its `before` state, so a registry that moved in between rolls everything back.
   */
  registryChanges?: PropertyChange[];
  /** Set only on a MORTGAGE: the mortgage record stored with it (its id is the transaction's). */
  newMortgage?: { playerId: string; propertyName: string; mortgageValue: number; tileId?: string };
  /** Set only on a MORTGAGE_REDEMPTION: the mortgage it closes. */
  redeemedMortgageId?: string;
  /** Set only on a LOAN_ISSUE: the loan record stored with it (its id is the transaction's). */
  newLoan?: {
    /** PLAYER when absent. */
    lenderKind?: LoanLenderKind;
    /** Null when the bank lends. */
    lenderPlayerId: string | null;
    borrowerPlayerId: string;
    principal: number;
    cooldownAcknowledged?: boolean;
  };
  /** Set only on a LOAN_REPAYMENT: the loan it pays down and its lender and borrower. */
  loanRepayment?: {
    loanId: string;
    /** Null for a bank loan. */
    lenderPlayerId: string | null;
    borrowerPlayerId: string;
    /** The principal paid down; for a bank loan the transaction amount also holds the interest. */
    amount: number;
    interestAmount?: number;
    interestRatePercent?: InterestRatePercent;
    suggestedRatePercent?: InterestRatePercent;
  };
  /**
   * Set only on a BANKRUPTCY_TRANSFER of a player with an active bank loan: what the bank took
   * from the wallet and how the loan ended. Written in the bankruptcy's own batch.
   */
  bankLoanSettlement?: {
    loanId: string;
    borrowerPlayerId: string;
    /** REPAID when the principal is covered; otherwise the loan is written off. */
    outcome: 'REPAID' | 'WRITTEN_OFF';
    /** Principal and interest the bank took; their sum is what left the wallet for the bank. */
    paidPrincipal: number;
    paidInterest: number;
    interestRatePercent: InterestRatePercent;
    suggestedRatePercent: InterestRatePercent;
  };
}

export interface PlayerBalanceChange {
  player: Player;
  balanceBefore: number;
  balanceAfter: number;
  balanceDelta: number;
}

export type BankingErrorCode =
  | 'INVALID_AMOUNT'
  | 'PLAYER_NOT_FOUND'
  | 'SAME_SOURCE_AND_DESTINATION'
  | 'INSUFFICIENT_FUNDS'
  | 'GAME_FINISHED'
  | 'PLAYER_BANKRUPT';

export abstract class BankingDomainError extends AppError {}

export class InvalidAmountError extends BankingDomainError {
  readonly code = 'INVALID_AMOUNT' as const;
  readonly amount: number;

  constructor(amount: number) {
    super({
      code: 'INVALID_AMOUNT',
      message: 'Amount must be a positive safe integer.',
      status: 400,
      details: { field: 'amount' },
    });
    this.amount = amount;
  }
}

export class PlayerNotFoundError extends BankingDomainError {
  readonly code = 'PLAYER_NOT_FOUND' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super({ code: 'PLAYER_NOT_FOUND', message: 'Player not found.', status: 404 });
    this.playerId = playerId;
  }
}

export class SameSourceAndDestinationError extends BankingDomainError {
  readonly code = 'SAME_SOURCE_AND_DESTINATION' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super({
      code: 'SAME_SOURCE_AND_DESTINATION',
      message: 'The source and destination players must be different.',
      status: 400,
    });
    this.playerId = playerId;
  }
}

export class InsufficientFundsError extends BankingDomainError {
  readonly code = 'INSUFFICIENT_FUNDS' as const;
  readonly playerId: string;
  readonly currentBalance: number;
  readonly requiredAmount: number;
  readonly shortfall: number;

  constructor(playerId: string, currentBalance: number, requiredAmount: number) {
    super({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Player does not have enough funds.',
      status: 409,
      details: {
        playerId,
        currentBalance,
        requiredAmount,
        shortfall: requiredAmount - currentBalance,
      },
    });
    this.playerId = playerId;
    this.currentBalance = currentBalance;
    this.requiredAmount = requiredAmount;
    this.shortfall = requiredAmount - currentBalance;
  }
}

export class InvalidGameStateError extends BankingDomainError {
  readonly code = 'GAME_FINISHED' as const;
  readonly reason: string;

  constructor(reason: string) {
    super({ code: 'GAME_FINISHED', message: 'This game is finished.', status: 409 });
    this.reason = reason;
  }
}

export class TransactionNotFoundError extends BankingDomainError {
  readonly code = 'TRANSACTION_NOT_FOUND' as const;
  constructor(transactionId: string) {
    super({
      code: 'TRANSACTION_NOT_FOUND',
      message: 'Transaction not found.',
      status: 404,
      details: { transactionId },
    });
  }
}

export class TransactionNotReversibleError extends BankingDomainError {
  readonly code = 'TRANSACTION_NOT_REVERSIBLE' as const;
  constructor(type: TransactionType) {
    super({
      code: 'TRANSACTION_NOT_REVERSIBLE',
      message: 'This kind of transaction cannot be reversed.',
      status: 409,
      details: { type },
    });
  }
}

export class TransactionAlreadyReversedError extends BankingDomainError {
  readonly code = 'TRANSACTION_ALREADY_REVERSED' as const;
  constructor(transactionId: string, reversalId: string) {
    super({
      code: 'TRANSACTION_ALREADY_REVERSED',
      message: 'This transaction has already been reversed.',
      status: 409,
      details: { transactionId, reversalId },
    });
  }
}

export class ReversalBlockedByLaterOperationError extends BankingDomainError {
  readonly code = 'REVERSAL_BLOCKED_BY_LATER_OPERATION' as const;
  constructor(transactionId: string, blockedBy: Pick<Transaction, 'id' | 'type'>) {
    super({
      code: 'REVERSAL_BLOCKED_BY_LATER_OPERATION',
      message: 'A later operation builds on this transaction, so it cannot be reversed.',
      status: 409,
      details: { transactionId, blockedBy: blockedBy.id, blockedByType: blockedBy.type },
    });
  }
}

export class JackpotEmptyError extends BankingDomainError {
  readonly code = 'JACKPOT_EMPTY' as const;
  constructor() {
    super({
      code: 'JACKPOT_EMPTY',
      message: 'The Free Parking pot is empty.',
      status: 409,
    });
  }
}

export class JackpotChangedError extends BankingDomainError {
  readonly code = 'JACKPOT_CHANGED' as const;
  constructor(jackpot: number, expectedAmount: number) {
    super({
      code: 'JACKPOT_CHANGED',
      message: 'The Free Parking pot changed. Review the new amount and try again.',
      status: 409,
      details: { jackpot, expectedAmount },
    });
  }
}

export class InvalidPropertyNameError extends BankingDomainError {
  readonly code = 'INVALID_PROPERTY_NAME' as const;
  constructor() {
    super({
      code: 'INVALID_PROPERTY_NAME',
      message: 'The property name must be 1 to 60 characters without control characters.',
      status: 400,
      details: { field: 'propertyName' },
    });
  }
}

export class MortgageNotFoundError extends BankingDomainError {
  readonly code = 'MORTGAGE_NOT_FOUND' as const;
  constructor(mortgageId: string) {
    super({
      code: 'MORTGAGE_NOT_FOUND',
      message: 'Mortgage not found.',
      status: 404,
      details: { mortgageId },
    });
  }
}

export class LoanNotFoundError extends BankingDomainError {
  readonly code = 'LOAN_NOT_FOUND' as const;
  constructor(loanId: string) {
    super({ code: 'LOAN_NOT_FOUND', message: 'Loan not found.', status: 404, details: { loanId } });
  }
}

export class LoanAmountExceedsDebtError extends BankingDomainError {
  readonly code = 'LOAN_AMOUNT_EXCEEDS_DEBT' as const;
  constructor(loanId: string, outstanding: number, amount: number) {
    super({
      code: 'LOAN_AMOUNT_EXCEEDS_DEBT',
      message: 'The amount is more than what is still owed on this loan.',
      status: 409,
      details: { loanId, outstanding, amount },
    });
  }
}

export class BankLoanLimitExceededError extends BankingDomainError {
  readonly code = 'BANK_LOAN_LIMIT_EXCEEDED' as const;
  constructor(amount: number, max: number) {
    super({
      code: 'BANK_LOAN_LIMIT_EXCEEDED',
      message: 'The amount is more than the bank lends.',
      status: 409,
      details: { amount, max },
    });
  }
}

export class BankLoanAlreadyActiveError extends BankingDomainError {
  readonly code = 'BANK_LOAN_ALREADY_ACTIVE' as const;
  constructor(playerId: string, loanId?: string) {
    super({
      code: 'BANK_LOAN_ALREADY_ACTIVE',
      message: 'This player already has a bank loan to repay.',
      status: 409,
      details: { playerId, ...(loanId === undefined ? {} : { loanId }) },
    });
  }
}

export class BankLoanCooldownError extends BankingDomainError {
  readonly code = 'BANK_LOAN_COOLDOWN' as const;
  constructor(playerId: string, roundsLeft: number) {
    super({
      code: 'BANK_LOAN_COOLDOWN',
      message: 'This player repaid a bank loan recently; borrowing again needs a confirmation.',
      status: 409,
      details: { playerId, roundsLeft },
    });
  }
}

export class BankLoanFullRepaymentRequiredError extends BankingDomainError {
  readonly code = 'BANK_LOAN_FULL_REPAYMENT_REQUIRED' as const;
  constructor(loanId: string, outstanding: number, amount: number) {
    super({
      code: 'BANK_LOAN_FULL_REPAYMENT_REQUIRED',
      message: 'A bank loan is repaid in full.',
      status: 409,
      details: { loanId, outstanding, amount },
    });
  }
}

export class PlayerBankruptError extends BankingDomainError {
  readonly code = 'PLAYER_BANKRUPT' as const;
  constructor(playerId: string) {
    super({
      code: 'PLAYER_BANKRUPT',
      message: 'This player is bankrupt.',
      status: 409,
      details: { playerId },
    });
  }
}

export function playerToPlayer(command: PlayerToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const source = findPlayer(players, command.sourcePlayerId);
  const destination = findPlayer(players, command.destinationPlayerId);
  ensureActive(source);
  ensureActive(destination);
  ensureDifferentPlayers(source, destination);
  ensureSufficientFunds(source, command.amount);

  return createResult(
    command.game.id,
    'PLAYER_TO_PLAYER',
    command.amount,
    command.amount,
    command.comment,
    [
      createBalanceChange(source, -command.amount),
      createBalanceChange(destination, command.amount),
    ],
  );
}

export function playerToBank(command: PlayerToBankCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, command.amount);

  return createResult(
    command.game.id,
    'PLAYER_TO_BANK',
    command.amount,
    command.amount,
    command.comment,
    [createBalanceChange(player, -command.amount)],
  );
}

/** The player pays a tax into the Free Parking pot instead of the bank. */
export function toJackpot(command: ToJackpotCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, command.amount);
  const result = createResult(
    command.game.id,
    'TO_JACKPOT',
    command.amount,
    command.amount,
    command.comment,
    [createBalanceChange(player, -command.amount)],
  );
  return {
    ...result,
    transaction: {
      ...result.transaction,
      jackpot: { kind: 'DEPOSIT', amount: command.amount },
    },
  };
}

/**
 * The player collects the whole pot, which the caller read on the server. An empty pot is refused,
 * and so is a pot that is not the one the player reviewed (`expectedAmount`).
 */
export function jackpotPayout(command: JackpotPayoutCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  if (command.jackpot === 0) throw new JackpotEmptyError();
  validateAmount(command.jackpot);
  if (command.jackpot !== command.expectedAmount)
    throw new JackpotChangedError(command.jackpot, command.expectedAmount);
  const result = createResult(
    command.game.id,
    'JACKPOT_PAYOUT',
    command.jackpot,
    command.jackpot,
    null,
    [createBalanceChange(player, command.jackpot)],
  );
  return {
    ...result,
    transaction: {
      ...result.transaction,
      jackpot: { kind: 'COLLECT', expected: command.jackpot },
    },
  };
}

/** The winner of an auction pays the bank the winning bid; the lot name is the comment. */
export function auctionPayment(command: AuctionPaymentCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, command.amount);
  const result = createResult(
    command.game.id,
    'AUCTION_PAYMENT',
    command.amount,
    command.amount,
    command.lotName,
    [createBalanceChange(player, -command.amount)],
  );
  if (command.tileId == null) return result;
  if (command.property === undefined)
    throw new InvalidGameStateError('a board auction needs the property registry');
  requireTile(command.property.board, command.tileId);
  const state = stateOf(command.property.registry, command.tileId);
  if (state.ownerPlayerId !== null)
    throw new PropertyAlreadyOwnedError(command.tileId, state.ownerPlayerId);
  return withProperty(result, command.tileId, [ownerChange(command.tileId, state, player.id)]);
}

/** Attaches the tile and the registry changes of an operation to its pending transaction. */
function withProperty(
  result: BankingOperationResult,
  tileId: string,
  registryChanges: PropertyChange[],
): BankingOperationResult {
  return { ...result, transaction: { ...result.transaction, tileId, registryChanges } };
}

/** A board tile is mortgaged for the snapshot's mortgage value; the registry flag turns on. */
export function mortgageTile(command: MortgageTileCommand): BankingOperationResult {
  const tile = requireTile(command.property.board, command.tileId);
  if (command.game.status !== 'ACTIVE')
    throw new InvalidGameStateError(`game status is ${command.game.status}`);
  assertCanMortgage(command.property, command.tileId, command.playerId);
  const result = mortgageProperty({
    game: command.game,
    players: command.players,
    playerId: command.playerId,
    propertyName: tile.name,
    amount: tile.mortgage,
  });
  const state = stateOf(command.property.registry, command.tileId);
  const newMortgage = result.transaction.newMortgage;
  const withTile = withProperty(result, tile.id, [mortgageChange(tile.id, state, true)]);
  return newMortgage === undefined
    ? withTile
    : {
        ...withTile,
        transaction: { ...withTile.transaction, newMortgage: { ...newMortgage, tileId: tile.id } },
      };
}

/** The player buys an unowned tile from the bank at the snapshot price. */
export function propertyPurchase(command: PropertyPurchaseCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const price = purchasePrice(command.property.board, command.tileId);
  validateAmount(price);
  const state = stateOf(command.property.registry, command.tileId);
  if (state.ownerPlayerId !== null)
    throw new PropertyAlreadyOwnedError(command.tileId, state.ownerPlayerId);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, price);
  const result = createResult(command.game.id, 'PROPERTY_PURCHASE', price, price, command.comment, [
    createBalanceChange(player, -price),
  ]);
  return withProperty(result, command.tileId, [ownerChange(command.tileId, state, player.id)]);
}

/** The payer pays the tile's owner the rent the registry and the snapshot give. */
export function payRent(command: PayRentCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const { board, registry } = command.property;
  const tile = requireTile(board, command.tileId);
  if (tile.type !== 'utility' && command.diceSum !== undefined) throw new DiceSumError(false);
  const state = stateOf(registry, command.tileId);
  if (state.ownerPlayerId === null) throw new PropertyNotOwnedError(command.tileId);
  if (state.mortgaged) throw new PropertyMortgagedError(command.tileId);
  const payer = findPlayer(players, command.payerPlayerId);
  const owner = findPlayer(players, state.ownerPlayerId);
  ensureActive(payer);
  ensureActive(owner);
  ensureDifferentPlayers(payer, owner);
  if (command.diceSum !== undefined) validateAmount(command.diceSum);
  const rent = rentFor(board, registry, command.tileId, command.diceSum);
  validateAmount(rent);
  ensureSufficientFunds(payer, rent);
  const result = createResult(command.game.id, 'PAY_RENT', rent, rent, command.comment, [
    createBalanceChange(payer, -rent),
    createBalanceChange(owner, rent),
  ]);
  return { ...result, transaction: { ...result.transaction, tileId: command.tileId } };
}

/** The bank pays the mortgage value; the property name becomes the transaction's comment. */
export function mortgageProperty(command: MortgagePropertyCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);
  // The bank must be able to be repaid: a value whose redemption cost is not a safe integer is refused.
  validateAmount(redemptionCost(command.amount));
  const propertyName = normalizePropertyName(command.propertyName);
  if (propertyName === null) throw new InvalidPropertyNameError();

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  const result = createResult(
    command.game.id,
    'MORTGAGE',
    command.amount,
    command.amount,
    propertyName,
    [createBalanceChange(player, command.amount)],
  );
  return {
    ...result,
    transaction: {
      ...result.transaction,
      newMortgage: { playerId: player.id, propertyName, mortgageValue: command.amount },
    },
  };
}

/** The player pays the bank the mortgage value plus 10%; only the player who mortgaged can redeem. */
export function redeemMortgage(command: RedeemMortgageCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const { mortgage } = command;
  if (mortgage.gameId !== command.game.id || mortgage.playerId !== command.playerId)
    throw new MortgageNotFoundError(mortgage.id);
  const cost = redemptionCost(mortgage.mortgageValue);
  validateAmount(cost);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, cost);
  const result = createResult(
    command.game.id,
    'MORTGAGE_REDEMPTION',
    cost,
    cost,
    mortgage.propertyName,
    [createBalanceChange(player, -cost)],
  );
  const redeemed: BankingOperationResult = {
    ...result,
    transaction: { ...result.transaction, redeemedMortgageId: mortgage.id },
  };
  if (mortgage.tileId == null) return redeemed;
  if (command.property === undefined)
    throw new InvalidGameStateError('a board mortgage needs the property registry');
  const state = stateOf(command.property.registry, mortgage.tileId);
  if (state.ownerPlayerId !== player.id || !state.mortgaged)
    throw new PropertyNotOwnedError(mortgage.tileId);
  return withProperty(redeemed, mortgage.tileId, [mortgageChange(mortgage.tileId, state, false)]);
}

/** The lender hands the borrower the amount; the loan record travels with the transaction. */
export function issueLoan(command: IssueLoanCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const lender = findPlayer(players, command.lenderPlayerId);
  const borrower = findPlayer(players, command.borrowerPlayerId);
  ensureActive(lender);
  ensureActive(borrower);
  ensureDifferentPlayers(lender, borrower);
  ensureSufficientFunds(lender, command.amount);
  const result = createResult(command.game.id, 'LOAN_ISSUE', command.amount, command.amount, null, [
    createBalanceChange(lender, -command.amount),
    createBalanceChange(borrower, command.amount),
  ]);
  return {
    ...result,
    transaction: {
      ...result.transaction,
      newLoan: {
        lenderPlayerId: lender.id,
        borrowerPlayerId: borrower.id,
        principal: command.amount,
      },
    },
  };
}

/** The borrower pays back part or all of what is still owed; only the borrower can repay a loan. */
export function repayLoan(command: RepayLoanCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const { loan } = command;
  if (
    loan.gameId !== command.game.id ||
    loan.borrowerPlayerId !== command.playerId ||
    loan.state !== 'ACTIVE' ||
    loan.lenderPlayerId === null
  )
    throw new LoanNotFoundError(loan.id);
  validateAmount(command.amount);
  const outstanding = loan.principal - loan.repaidAmount;
  if (command.amount > outstanding)
    throw new LoanAmountExceedsDebtError(loan.id, outstanding, command.amount);

  const borrower = findPlayer(players, command.playerId);
  const lender = findPlayer(players, loan.lenderPlayerId);
  ensureActive(borrower);
  ensureActive(lender);
  ensureSufficientFunds(borrower, command.amount);
  const result = createResult(
    command.game.id,
    'LOAN_REPAYMENT',
    command.amount,
    command.amount,
    null,
    [createBalanceChange(borrower, -command.amount), createBalanceChange(lender, command.amount)],
  );
  return {
    ...result,
    transaction: {
      ...result.transaction,
      loanRepayment: {
        loanId: loan.id,
        lenderPlayerId: lender.id,
        borrowerPlayerId: borrower.id,
        amount: command.amount,
      },
    },
  };
}

/**
 * The bank pays the borrower at once. At most `settings.bankLoanMax` (derived from the starting
 * balance for games created before the settings snapshot), one active bank loan per player, and a
 * confirmed warning while the borrower is still in the cooldown after repaying the previous one.
 */
export function issueBankLoan(command: IssueBankLoanCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);
  const max = (command.game.settings ?? buildGameSettings(command.game.startingBalance))
    .bankLoanMax;
  if (command.amount > max) throw new BankLoanLimitExceededError(command.amount, max);

  const borrower = findPlayer(players, command.playerId);
  ensureActive(borrower);
  if (command.activeBankLoan != null)
    throw new BankLoanAlreadyActiveError(borrower.id, command.activeBankLoan.id);
  const cooldown = command.cooldown ?? null;
  if (cooldown !== null && command.acknowledgeCooldown !== true)
    throw new BankLoanCooldownError(borrower.id, cooldown.roundsLeft);
  const result = createResult(command.game.id, 'LOAN_ISSUE', command.amount, command.amount, null, [
    createBalanceChange(borrower, command.amount),
  ]);
  return {
    ...result,
    transaction: {
      ...result.transaction,
      newLoan: {
        lenderKind: 'BANK',
        lenderPlayerId: null,
        borrowerPlayerId: borrower.id,
        principal: command.amount,
        cooldownAcknowledged: cooldown !== null,
      },
    },
  };
}

/**
 * The borrower pays the whole principal plus interest to the bank. The interest is the principal
 * times the confirmed rate (half up); it leaves the game with the rest of the payment.
 */
export function repayBankLoan(command: RepayBankLoanCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const { loan } = command;
  if (
    loan.gameId !== command.game.id ||
    loan.borrowerPlayerId !== command.playerId ||
    loan.state !== 'ACTIVE' ||
    loan.lenderKind !== 'BANK'
  )
    throw new LoanNotFoundError(loan.id);
  validateAmount(command.amount);
  const outstanding = loan.principal - loan.repaidAmount;
  if (command.amount !== outstanding)
    throw new BankLoanFullRepaymentRequiredError(loan.id, outstanding, command.amount);
  const interest = bankLoanInterest(outstanding, command.interestRatePercent);
  const total = outstanding + interest;
  validateAmount(total);

  const borrower = findPlayer(players, command.playerId);
  ensureActive(borrower);
  ensureSufficientFunds(borrower, total);
  const result = createResult(command.game.id, 'LOAN_REPAYMENT', total, total, null, [
    createBalanceChange(borrower, -total),
  ]);
  return {
    ...result,
    transaction: {
      ...result.transaction,
      loanRepayment: {
        loanId: loan.id,
        lenderPlayerId: null,
        borrowerPlayerId: borrower.id,
        amount: outstanding,
        interestAmount: interest,
        interestRatePercent: command.interestRatePercent,
        suggestedRatePercent: command.suggestedRatePercent,
      },
    },
  };
}

export function bankToPlayer(command: BankToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  return createResult(
    command.game.id,
    'BANK_TO_PLAYER',
    command.amount,
    command.amount,
    command.comment,
    [createBalanceChange(player, command.amount)],
  );
}

export function playerToAll(command: PlayerToAllCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amountPerPlayer);

  const payer = findPlayer(players, command.payerPlayerId);
  ensureActive(payer);
  const recipients = players.filter(
    (player) => player.id !== payer.id && player.status !== 'BANKRUPT',
  );
  const totalAmount = multiplyAmounts(command.amountPerPlayer, recipients.length);
  ensureSufficientFunds(payer, totalAmount);

  return createResult(
    command.game.id,
    'PLAYER_TO_ALL',
    command.amountPerPlayer,
    totalAmount,
    command.comment,
    [
      createBalanceChange(payer, -totalAmount),
      ...recipients.map((recipient) => createBalanceChange(recipient, command.amountPerPlayer)),
    ],
  );
}

export function allToPlayer(command: AllToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amountPerPlayer);

  const recipient = findPlayer(players, command.recipientPlayerId);
  ensureActive(recipient);
  const payers = players.filter(
    (player) => player.id !== recipient.id && player.status !== 'BANKRUPT',
  );
  for (const payer of payers) {
    ensureSufficientFunds(payer, command.amountPerPlayer);
  }

  const totalAmount = multiplyAmounts(command.amountPerPlayer, payers.length);
  return createResult(
    command.game.id,
    'ALL_TO_PLAYER',
    command.amountPerPlayer,
    totalAmount,
    command.comment,
    [
      ...payers.map((payer) => createBalanceChange(payer, -command.amountPerPlayer)),
      createBalanceChange(recipient, totalAmount),
    ],
  );
}

export function passGo(command: PassGoCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.game.passGoReward);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  const reward = multiplyAmounts(command.game.passGoReward, command.exactLanding === true ? 2 : 1);
  return createResult(command.game.id, 'PASS_GO', reward, reward, command.comment, [
    createBalanceChange(player, reward),
  ]);
}

/**
 * Moves exactly the original deltas back as a new REVERSAL record. Every participant must still be
 * active and, where the original paid them, still hold the money; otherwise nothing is reversed.
 */
export function reverseTransaction(command: ReversalCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const { original } = command;
  if (original.gameId !== command.game.id) throw new TransactionNotFoundError(original.id);
  if (!isReversibleType(original.type)) throw new TransactionNotReversibleError(original.type);
  if (original.reversedByTransactionId != null)
    throw new TransactionAlreadyReversedError(original.id, original.reversedByTransactionId);
  const dependency = findReversalDependency(original, command.later ?? []);
  if (dependency !== null) throw new ReversalBlockedByLaterOperationError(original.id, dependency);

  // A registry-backed original moves its tiles back too; one that lost its changes cannot be undone.
  const registryChanges = invertChanges(command.originalRegistryChanges ?? []);
  if (
    registryChanges.length === 0 &&
    (original.type === 'PROPERTY_PURCHASE' ||
      (original.tileId != null && original.type === 'AUCTION_PAYMENT'))
  )
    throw new TransactionNotReversibleError(original.type);

  const changes = original.participants.map((participant) => {
    const player = findPlayer(players, participant.playerId);
    ensureActive(player);
    const balanceDelta = -participant.balanceDelta;
    if (balanceDelta < 0) ensureSufficientFunds(player, -balanceDelta);
    return createBalanceChange(player, balanceDelta);
  });
  const result = createResult(
    command.game.id,
    'REVERSAL',
    original.amount,
    original.totalAmount,
    command.comment,
    changes,
  );
  return {
    ...result,
    transaction: {
      ...result.transaction,
      reversesTransactionId: original.id,
      ...(registryChanges.length === 0
        ? {}
        : {
            registryChanges,
            ...(original.tileId == null ? {} : { tileId: original.tileId }),
          }),
    },
  };
}

export function declareBankruptcy(command: BankruptcyCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const bankruptPlayer = findPlayer(players, command.playerId);
  ensureActive(bankruptPlayer);
  const creditor =
    command.creditorPlayerId === undefined ? null : findPlayer(players, command.creditorPlayerId);
  if (creditor !== null) {
    ensureActive(creditor);
    ensureDifferentPlayers(bankruptPlayer, creditor);
  }
  const cash = bankruptPlayer.balance;
  const settlement = settleBankLoan(command, bankruptPlayer);
  const registryChanges = bankruptcyRegistryChanges(command, bankruptPlayer, creditor);
  if (cash === 0) {
    return withRegistryChanges(
      withBankLoanSettlement(
        createResult(command.game.id, 'BANKRUPTCY_TRANSFER', 1, 1, null, []),
        settlement,
      ),
      registryChanges,
    );
  }
  // The bank is owed first; a player creditor only receives what is left of the wallet.
  const bankTake = settlement === null ? 0 : settlement.paidPrincipal + settlement.paidInterest;
  const creditorShare = cash - bankTake;
  return withRegistryChanges(
    withBankLoanSettlement(
      createResult(command.game.id, 'BANKRUPTCY_TRANSFER', cash, cash, null, [
        createBalanceChange(bankruptPlayer, -cash),
        ...(creditor === null || creditorShare === 0
          ? []
          : [createBalanceChange(creditor, creditorShare)]),
      ]),
      settlement,
    ),
    registryChanges,
  );
}

/**
 * Board games: every tile of the bankrupt player passes to the creditor (mortgage flag kept, so the
 * creditor can redeem it), or goes back to the bank unmortgaged. Buildings are not handled yet.
 */
function bankruptcyRegistryChanges(
  command: BankruptcyCommand,
  bankruptPlayer: Player,
  creditor: Player | null,
): PropertyChange[] {
  if (command.property === undefined) return [];
  return command.property.registry
    .filter((row) => row.ownerPlayerId === bankruptPlayer.id)
    .map((row) =>
      ownerChange(
        row.tileId,
        { ownerPlayerId: row.ownerPlayerId, mortgaged: row.mortgaged, houses: row.houses },
        creditor?.id ?? null,
      ),
    );
}

function withRegistryChanges(
  result: BankingOperationResult,
  registryChanges: PropertyChange[],
): BankingOperationResult {
  return registryChanges.length === 0
    ? result
    : { ...result, transaction: { ...result.transaction, registryChanges } };
}

type BankLoanSettlement = NonNullable<PendingTransaction['bankLoanSettlement']>;

/**
 * What the bank takes from a bankrupt player's wallet for their active bank loan: the debt is the
 * outstanding principal plus interest at the suggested rate, and the bank takes whatever of it the
 * cash covers, principal first. Once the principal is covered the loan counts as repaid (interest
 * the wallet could not cover is forgiven); otherwise it is written off.
 */
function settleBankLoan(
  command: BankruptcyCommand,
  bankruptPlayer: Player,
): BankLoanSettlement | null {
  if (command.bankLoan === undefined) return null;
  const { loan, suggestedRatePercent } = command.bankLoan;
  if (
    loan.gameId !== command.game.id ||
    loan.borrowerPlayerId !== bankruptPlayer.id ||
    loan.state !== 'ACTIVE' ||
    loan.lenderKind !== 'BANK'
  )
    throw new LoanNotFoundError(loan.id);
  const outstanding = loan.principal - loan.repaidAmount;
  const debt = outstanding + bankLoanInterest(loan.principal, suggestedRatePercent);
  const taken = Math.min(bankruptPlayer.balance, debt);
  const paidPrincipal = Math.min(taken, outstanding);
  return {
    loanId: loan.id,
    borrowerPlayerId: bankruptPlayer.id,
    outcome: paidPrincipal === outstanding ? 'REPAID' : 'WRITTEN_OFF',
    paidPrincipal,
    paidInterest: taken - paidPrincipal,
    interestRatePercent: suggestedRatePercent,
    suggestedRatePercent,
  };
}

function withBankLoanSettlement(
  result: BankingOperationResult,
  settlement: BankLoanSettlement | null,
): BankingOperationResult {
  return settlement === null
    ? result
    : { ...result, transaction: { ...result.transaction, bankLoanSettlement: settlement } };
}

function validateGame(game: Game, players: readonly Player[]): readonly Player[] {
  if (game.status !== 'ACTIVE') {
    throw new InvalidGameStateError(`game status is ${game.status}`);
  }

  if (players.length < 2 || players.length > 6) {
    throw new InvalidGameStateError('a game must contain between 2 and 6 players');
  }

  const playerIds = new Set<string>();
  for (const player of players) {
    if (player.gameId !== game.id) {
      throw new InvalidGameStateError(`player "${player.id}" belongs to another game`);
    }
    if (!Number.isSafeInteger(player.balance) || player.balance < 0) {
      throw new InvalidGameStateError(`player "${player.id}" has an invalid balance`);
    }
    if (playerIds.has(player.id)) {
      throw new InvalidGameStateError(`player "${player.id}" appears more than once`);
    }
    playerIds.add(player.id);
  }

  return players;
}

function validateAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidAmountError(amount);
  }
}

function findPlayer(players: readonly Player[], playerId: string): Player {
  const player = players.find((candidate) => candidate.id === playerId);
  if (player === undefined) {
    throw new PlayerNotFoundError(playerId);
  }
  return player;
}

function ensureDifferentPlayers(source: Player, destination: Player): void {
  if (source.id === destination.id) {
    throw new SameSourceAndDestinationError(source.id);
  }
}

function ensureSufficientFunds(player: Player, requiredAmount: number): void {
  if (player.balance < requiredAmount) {
    throw new InsufficientFundsError(player.id, player.balance, requiredAmount);
  }
}

function ensureActive(player: Player): void {
  if (player.status === 'BANKRUPT') {
    throw new PlayerBankruptError(player.id);
  }
}

function multiplyAmounts(amount: number, multiplier: number): number {
  const totalAmount = amount * multiplier;
  if (!Number.isSafeInteger(totalAmount)) {
    throw new InvalidAmountError(totalAmount);
  }
  return totalAmount;
}

function createBalanceChange(player: Player, balanceDelta: number): PlayerBalanceChange {
  const balanceAfter = player.balance + balanceDelta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new InvalidGameStateError(
      `operation would produce an invalid balance for player "${player.id}"`,
    );
  }

  return {
    player,
    balanceBefore: player.balance,
    balanceAfter,
    balanceDelta,
  };
}

function createResult(
  gameId: string,
  type: TransactionType,
  amount: number,
  totalAmount: number,
  comment: string | null | undefined,
  affectedPlayers: PlayerBalanceChange[],
): BankingOperationResult {
  return {
    transaction: {
      gameId,
      type,
      amount,
      totalAmount,
      comment: comment ?? null,
      participants: affectedPlayers.map(({ player, balanceDelta }) => ({
        playerId: player.id,
        balanceDelta,
      })),
    },
    affectedPlayers,
  };
}
