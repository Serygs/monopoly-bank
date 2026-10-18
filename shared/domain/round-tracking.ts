import type {
  BankLoanCooldown,
  InterestRatePercent,
  Loan,
  LoanRoundStatus,
  Transaction,
  TransactionType,
} from '../types/monopoly.js';
import { type ParticipantSide, soleParticipant } from './participants.js';

/** A loan is overdue once it reaches this round without being repaid. */
export const OVERDUE_ROUND = 4;
/** After repaying a bank loan, a player waits this many rounds before borrowing without a warning. */
export const BANK_LOAN_COOLDOWN_ROUNDS = 2;

const ACTOR_SIDE: Partial<Record<TransactionType, ParticipantSide>> = {
  PLAYER_TO_PLAYER: 'DEBIT',
  PAY_RENT: 'DEBIT',
  PLAYER_TO_BANK: 'DEBIT',
  PLAYER_TO_ALL: 'DEBIT',
  TO_JACKPOT: 'DEBIT',
  BANK_TO_PLAYER: 'CREDIT',
  PASS_GO: 'CREDIT',
  ALL_TO_PLAYER: 'CREDIT',
  JACKPOT_PAYOUT: 'CREDIT',
};

/**
 * The app never stores or enforces turn order. A "turn" is inferred from whose operations follow
 * one another in the transaction log: it is a hint for bank-loan interest, nothing more. A player
 * who has since gone bankrupt still took their earlier turns, so their operations keep counting;
 * dropping them would merge the turns around them and make a live loan's round go backwards.
 */
export function transactionActor(
  transaction: Pick<Transaction, 'type' | 'participants' | 'reversedByTransactionId'>,
): string | null {
  if (transaction.reversedByTransactionId != null) return null;
  const side = ACTOR_SIDE[transaction.type];
  return side === undefined ? null : soleParticipant(transaction.participants, side);
}

/**
 * How many times `playerId` started a turn after the anchor transaction. The actors of the
 * transactions after the anchor are collapsed (one player acting repeatedly is one turn); each run
 * by `playerId` that follows a run by someone else is a turn start. A run right after the anchor
 * is the turn the anchor itself happened in and does not count. `transactions` is oldest first.
 */
export function turnsStartedSince(
  transactions: readonly Pick<
    Transaction,
    'id' | 'type' | 'participants' | 'reversedByTransactionId'
  >[],
  anchorTransactionId: string,
  playerId: string,
): number {
  const anchorIndex = transactions.findIndex(
    (transaction) => transaction.id === anchorTransactionId,
  );
  if (anchorIndex === -1) return 0;
  const runs: string[] = [];
  for (const transaction of transactions.slice(anchorIndex + 1)) {
    const actor = transactionActor(transaction);
    if (actor !== null && runs[runs.length - 1] !== actor) runs.push(actor);
  }
  return runs.filter((actor, index) => actor === playerId && index > 0).length;
}

export function suggestedRatePercent(round: number): InterestRatePercent {
  return round <= 1 ? 0 : round === 2 ? 10 : 20;
}

export function loanRoundStatus(
  transactions: Parameters<typeof turnsStartedSince>[0],
  loan: Pick<Loan, 'id' | 'borrowerPlayerId'>,
): LoanRoundStatus {
  const round = 1 + turnsStartedSince(transactions, loan.id, loan.borrowerPlayerId);
  return {
    round,
    suggestedRatePercent: suggestedRatePercent(round),
    overdue: round >= OVERDUE_ROUND,
  };
}

/** The ACTIVE bank loans with their round; player loans are returned untouched. */
export function withLoanRounds(
  loans: readonly Loan[],
  transactions: Parameters<typeof turnsStartedSince>[0],
): Loan[] {
  return loans.map((loan) =>
    loan.lenderKind === 'BANK' && loan.state === 'ACTIVE'
      ? { ...loan, rounds: loanRoundStatus(transactions, loan) }
      : loan,
  );
}

/**
 * Players still waiting out the cooldown after repaying a bank loan. `repayments` holds each
 * player's bank-loan repayments oldest first; only the latest one per player matters.
 */
export function bankLoanCooldowns(
  repayments: readonly { playerId: string; transactionId: string }[],
  transactions: Parameters<typeof turnsStartedSince>[0],
  bankrupt: ReadonlySet<string>,
): BankLoanCooldown[] {
  const latest = new Map<string, string>();
  for (const repayment of repayments) latest.set(repayment.playerId, repayment.transactionId);
  const cooldowns: BankLoanCooldown[] = [];
  for (const [playerId, transactionId] of latest) {
    if (bankrupt.has(playerId)) continue;
    const roundsLeft =
      BANK_LOAN_COOLDOWN_ROUNDS - turnsStartedSince(transactions, transactionId, playerId);
    if (roundsLeft > 0) cooldowns.push({ playerId, roundsLeft });
  }
  return cooldowns;
}
