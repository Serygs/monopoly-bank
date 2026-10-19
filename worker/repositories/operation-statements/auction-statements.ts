import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function auctionStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // Settling an auction closes it in the same batch as its payment. If it is no longer ACTIVE at
  // the version that was read (a concurrent settlement, a bid, a bankrupt leader), 'NOT_ACTIVE'
  // breaks the state CHECK and the whole batch, balance included, rolls back.
  const auctionStatements: D1PreparedStatement[] = [];
  const { settlesAuction } = input.transaction;
  if (settlesAuction !== undefined)
    auctionStatements.push(
      database
        .prepare(
          `UPDATE auctions
             SET state = CASE WHEN state = 'ACTIVE' AND version = ?1 THEN 'SOLD' ELSE 'NOT_ACTIVE' END,
                 settled_transaction_id = ?2, version = version + 1
             WHERE id = ?3 AND game_id = ?4`,
        )
        .bind(
          settlesAuction.expectedVersion,
          input.transactionId,
          settlesAuction.auctionId,
          input.transaction.gameId,
        ),
    );
  if (input.bankruptPlayerId !== undefined && input.withdrawAuctionBid === true)
    auctionStatements.push(
      database
        .prepare(
          `UPDATE auctions SET current_bidder_id = NULL, version = version + 1
             WHERE game_id = ? AND state = 'ACTIVE' AND current_bidder_id = ?`,
        )
        .bind(input.transaction.gameId, input.bankruptPlayerId),
    );

  return auctionStatements;
}
