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
}

export interface LoanRepository {
  /** The loans still being repaid in a game, oldest first. */
  listActive(gameId: string): Promise<Loan[]>;
  /** One active loan, or `null` when it does not exist, belongs to another game or is closed. */
  getActive(gameId: string, loanId: string): Promise<Loan | null>;
}

const columns =
  'id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount, state, created_at, closed_at';

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
  };
}
