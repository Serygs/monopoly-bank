import type { BankruptcyRequest, PlayerTransactionRequest } from '../contracts/api.js';

/**
 * Every banking command has one wallet whose controller must authorize it.
 * This deliberately describes authority, not the complete set of balances an
 * operation may affect (for example, ALL_TO_PLAYER debits several wallets).
 */
export function controlledPlayerIdForBankingCommand(
  request: PlayerTransactionRequest | BankruptcyRequest,
): string {
  if (!('type' in request)) return request.playerId;
  switch (request.type) {
    case 'PLAYER_TO_PLAYER':
      return request.sourcePlayerId;
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER':
    case 'PASS_GO':
    case 'MORTGAGE':
    case 'MORTGAGE_REDEMPTION':
    case 'LOAN_REPAYMENT':
    case 'TO_JACKPOT':
    case 'JACKPOT_PAYOUT':
    case 'PROPERTY_PURCHASE':
    case 'PROPERTY_BUILD':
    case 'PROPERTY_SELL_BUILDING':
    case 'PROPERTY_TRANSFER':
      return request.playerId;
    case 'PAY_RENT':
      return request.payerPlayerId;
    case 'LOAN_ISSUE':
      return request.lenderKind === 'BANK' ? request.playerId : request.borrowerPlayerId;
    case 'PLAYER_TO_ALL':
      return request.payerPlayerId;
    case 'ALL_TO_PLAYER':
      return request.recipientPlayerId;
  }
}
