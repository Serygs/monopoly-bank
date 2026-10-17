import { bankLoanCooldowns, withLoanRounds } from '../../shared/domain/round-tracking.js';
import type { BankLoanCooldown, Loan, Player } from '../../shared/types/monopoly.js';
import type { LoanRepository } from '../repositories/loan-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';

/** The ACTIVE loans (bank loans with their round) and who is in the bank-loan cooldown. */
export interface BankLoanView {
  loans: Loan[];
  bankLoanCooldowns: BankLoanCooldown[];
}

/**
 * A cooldown lasts two of the player's turns. A repayment this many transactions back is treated as
 * over, so a long game does not re-read its whole log after every operation just for a cooldown.
 */
export const COOLDOWN_SCAN_TRANSACTIONS = 300;

/**
 * Derives rounds and cooldowns from the operation log on read; nothing about turns is stored. Only
 * the transactions since the oldest anchor (an active bank loan, or the latest bank-loan repayment
 * of a player) are read, and none at all when the game has neither. Without an active bank loan,
 * at most the newest COOLDOWN_SCAN_TRANSACTIONS are read.
 */
export async function loadBankLoanView(
  repositories: { loans: LoanRepository; transactions: TransactionRepository },
  gameId: string,
  players: readonly Pick<Player, 'id' | 'status'>[],
): Promise<BankLoanView> {
  const bankrupt = new Set(
    players.filter((player) => player.status === 'BANKRUPT').map((player) => player.id),
  );
  const [loans, repayments] = await Promise.all([
    repositories.loans.listActive(gameId),
    repositories.loans.listBankLoanRepayments(gameId),
  ]);
  const latestRepayments = new Map<string, string>();
  for (const repayment of repayments)
    latestRepayments.set(repayment.playerId, repayment.transactionId);
  const loanAnchors = loans.filter((loan) => loan.lenderKind === 'BANK').map((loan) => loan.id);
  const anchors = [
    ...loanAnchors,
    ...[...latestRepayments]
      .filter(([playerId]) => !bankrupt.has(playerId))
      .map(([, transactionId]) => transactionId),
  ];
  if (anchors.length === 0) return { loans, bankLoanCooldowns: [] };
  const transactions = await repositories.transactions.listChronologicalSince(
    gameId,
    anchors,
    loanAnchors.length === 0 ? COOLDOWN_SCAN_TRANSACTIONS : undefined,
  );
  const read = new Set(transactions.map((transaction) => transaction.id));
  return {
    loans: withLoanRounds(loans, transactions),
    bankLoanCooldowns: bankLoanCooldowns(
      // A repayment outside the window read is long past its cooldown.
      [...latestRepayments]
        .filter(([, transactionId]) => read.has(transactionId))
        .map(([playerId, transactionId]) => ({ playerId, transactionId })),
      transactions,
      bankrupt,
    ),
  };
}
