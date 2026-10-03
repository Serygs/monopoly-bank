import type { BankruptcyRequest, CreateTransactionRequest } from '../contracts/api.js';

/**
 * Every banking command has one wallet whose controller must authorize it.
 * This deliberately describes authority, not the complete set of balances an
 * operation may affect (for example, ALL_TO_PLAYER debits several wallets).
 */
export function controlledPlayerIdForBankingCommand(
  request: CreateTransactionRequest | BankruptcyRequest,
): string {
  if (!('type' in request)) return request.playerId;
  switch (request.type) {
    case 'PLAYER_TO_PLAYER':
      return request.sourcePlayerId;
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER':
    case 'PASS_GO':
      return request.playerId;
    case 'PLAYER_TO_ALL':
      return request.payerPlayerId;
    case 'ALL_TO_PLAYER':
      return request.recipientPlayerId;
  }
}
