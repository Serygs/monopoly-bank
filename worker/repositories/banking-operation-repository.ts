import type { PlayerBalanceChange, PendingTransaction } from '../../shared/domain/banking.js';
import { DatabaseError } from '../services/errors.js';
import { guardedBalanceUpdate } from './balance-statements.js';
import { auctionStatements } from './operation-statements/auction-statements.js';
import { bankruptcyStatements } from './operation-statements/bankruptcy-statements.js';
import { jackpotStatements } from './operation-statements/jackpot-statements.js';
import { transactionStatements } from './operation-statements/ledger-statements.js';
import { loanStatements } from './operation-statements/loan-statements.js';
import { mortgageStatements } from './operation-statements/mortgage-statements.js';
import { registryStatements } from './operation-statements/registry-statements.js';
import {
  acceptedTradeStatements,
  bankruptTradeStatements,
} from './operation-statements/trade-statements.js';

export interface PersistBankingOperationInput {
  transactionId: string;
  transaction: PendingTransaction;
  balanceChanges: readonly PlayerBalanceChange[];
  bankruptPlayerId?: string;
  /**
   * With a bankruptcy: the player who takes over the bankrupt player's mortgages (the creditor).
   * Without one the mortgages are released, as the properties went back to the bank.
   */
  mortgageHeirPlayerId?: string | null;
  /**
   * With a bankruptcy: the player who takes over the loans the bankrupt player made (the
   * creditor). Without one every such loan is written off. Loans the bankrupt player owes are
   * always written off.
   */
  loanHeirPlayerId?: string | null;
  /**
   * With a bankruptcy in a game with the auctions rule: the leading bidder's bid is withdrawn (no
   * leader, the floor stays) in the bankruptcy's own batch.
   */
  withdrawAuctionBid?: boolean;
  /**
   * With an accepted trade: the pending trade request this transaction fulfils. It turns ACCEPTED
   * in the same batch; a request that is no longer pending (or has expired) breaks the state CHECK
   * on purpose, so the whole batch rolls back and nothing is written.
   */
  acceptTradeRequestId?: string;
  recentAmount?: number;
}

export interface BankingOperationRepository {
  persist(input: PersistBankingOperationInput): Promise<void>;
}

export class D1BankingOperationRepository implements BankingOperationRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async persist(input: PersistBankingOperationInput): Promise<void> {
    const { database } = this;
    const statements = [
      guardedBalanceUpdate(database, input.balanceChanges),
      ...transactionStatements(database, input),
      ...acceptedTradeStatements(database, input),
      ...registryStatements(database, input),
      ...mortgageStatements(database, input),
      ...loanStatements(database, input),
      ...jackpotStatements(database, input),
      ...auctionStatements(database, input),
      ...bankruptcyStatements(database, input),
      ...bankruptTradeStatements(database, input),
    ];
    try {
      const recentStatements =
        input.recentAmount === undefined
          ? []
          : recentAmountStatements(database, input.transaction.gameId, input.recentAmount);
      await database.batch([...statements, ...recentStatements]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'persistBankingOperation', cause });
    }
  }
}

function recentAmountStatements(
  database: D1Database,
  gameId: string,
  amount: number,
): D1PreparedStatement[] {
  return [
    database
      .prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?')
      .bind(gameId, amount),
    database
      .prepare(
        'INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      )
      .bind(gameId, amount),
    database
      .prepare(
        'DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)',
      )
      .bind(gameId, gameId),
  ];
}
