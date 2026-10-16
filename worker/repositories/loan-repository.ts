import type { Loan, LoanLenderKind, LoanState } from '../../shared/types/monopoly.js';

interface LoanRow {
  id: string;
  game_id: string;
  lender_kind: LoanLenderKind;
  lender_player_id: string | null;
  borrower_player_id: string;
  principal: number;
  repaid_amount: number;
  state: LoanState;
  created_at: string;
  closed_at: string | null;
  cooldown_acknowledged: number;
}

/** A fully repaid bank loan: who repaid it and with which transaction. */
export interface BankLoanRepayment {
  playerId: string;
  transactionId: string;
}

export interface LoanRepository {
  /** The loans still being repaid in a game, oldest first. */
  listActive(gameId: string): Promise<Loan[]>;
  /** One active loan, or `null` when it does not exist, belongs to another game or is closed. */
  getActive(gameId: string, loanId: string): Promise<Loan | null>;
  /** The repayments that closed bank loans of the game, oldest first (for the cooldown). */
  listBankLoanRepayments(gameId: string): Promise<BankLoanRepayment[]>;
}

const columns =
  'id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount, state, created_at, closed_at, cooldown_acknowledged';

export class D1LoanRepository implements LoanRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async listActive(gameId: string): Promise<Loan[]> {
    const result = await this.database
      .prepare(
        `SELECT ${columns} FROM loans WHERE game_id = ? AND state = 'ACTIVE' ORDER BY created_at ASC, id ASC`,
      )
      .bind(gameId)
      .all<LoanRow>();
    return result.results.map(mapLoan);
  }

  async listBankLoanRepayments(gameId: string): Promise<BankLoanRepayment[]> {
    const result = await this.database
      .prepare(
        `SELECT loans.borrower_player_id AS player_id, loan_repayments.transaction_id AS transaction_id
         FROM loans
         JOIN loan_repayments ON loan_repayments.loan_id = loans.id AND loan_repayments.game_id = loans.game_id
         JOIN transactions ON transactions.id = loan_repayments.transaction_id AND transactions.game_id = loans.game_id
         WHERE loans.game_id = ? AND loans.lender_kind = 'BANK' AND loans.state = 'REPAID'
         ORDER BY transactions.rowid ASC`,
      )
      .bind(gameId)
      .all<{ player_id: string; transaction_id: string }>();
    return result.results.map((row) => ({
      playerId: row.player_id,
      transactionId: row.transaction_id,
    }));
  }

  async getActive(gameId: string, loanId: string): Promise<Loan | null> {
    const row = await this.database
      .prepare(`SELECT ${columns} FROM loans WHERE game_id = ? AND id = ? AND state = 'ACTIVE'`)
      .bind(gameId, loanId)
      .first<LoanRow>();
    return row === null ? null : mapLoan(row);
  }
}

function mapLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    gameId: row.game_id,
    lenderKind: row.lender_kind,
    lenderPlayerId: row.lender_player_id,
    borrowerPlayerId: row.borrower_player_id,
    principal: row.principal,
    repaidAmount: row.repaid_amount,
    state: row.state,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    ...(row.lender_kind === 'BANK'
      ? { cooldownAcknowledged: row.cooldown_acknowledged === 1 }
      : {}),
  };
}
