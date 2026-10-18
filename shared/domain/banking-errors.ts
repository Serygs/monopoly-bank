import type { Transaction, TransactionType } from '../types/monopoly.js';
import { AppError } from '../../worker/services/errors.js';

export class InvalidTradeError extends AppError {
  constructor(reason: string) {
    super({ code: 'INVALID_TRADE', message: reason, status: 400, details: { reason } });
  }
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

export class NoOtherActivePlayersError extends BankingDomainError {
  readonly code = 'NO_OTHER_ACTIVE_PLAYERS' as const;

  constructor() {
    super({
      code: 'NO_OTHER_ACTIVE_PLAYERS',
      message: 'There is no other active player to pay or collect from.',
      status: 409,
    });
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

export const BANK_TO_PLAYER_MAX_AMOUNT = 4_000_000;

export class BankToPlayerLimitExceededError extends BankingDomainError {
  readonly code = 'BANK_TO_PLAYER_LIMIT_EXCEEDED' as const;
  constructor(amount: number, max: number) {
    super({
      code: 'BANK_TO_PLAYER_LIMIT_EXCEEDED',
      message: 'The bank pays a player at most the limit in one operation.',
      status: 400,
      details: { field: 'amount', amount, max },
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

/** A player creditor cannot cover the mortgage fees of the tiles they would inherit. */
export class BankruptcyCreditorShortError extends AppError {
  constructor(creditorPlayerId: string, required: number, available: number) {
    super({
      code: 'BANKRUPTCY_CREDITOR_SHORT',
      message: 'The creditor cannot pay the mortgage fees of the inherited properties.',
      status: 409,
      details: {
        creditorPlayerId,
        required,
        available,
        shortfall: required - available,
      },
    });
  }
}
