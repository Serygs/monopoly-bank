import type {
  BankruptcyRequest,
  CreateTradeRequest,
  CreateTransactionRequest,
  JailBailRequest,
  PropertyAuctionRequest,
  PropertyBuildRequest,
  PropertyMortgageRequest,
  PropertyPurchaseRequest,
  PropertyRentRequest,
  PropertySellBuildingsRequest,
  PropertyUnmortgageRequest,
} from '../contracts/api.js';

/**
 * Rent as the domain sees it: the wire request plus the owner the route resolved
 * from the stored deed. `ownerPlayerId` is a server-derived value and never a
 * request field — `PropertyRentRequest` has no owner to parse, and the only way
 * to fill this one in is `rentBankingCommand`, which demands the resolved owner.
 */
export interface RentBankingCommand extends PropertyRentRequest {
  readonly ownerPlayerId?: string;
}

/**
 * Builds the rent command from a request and the owner of `boardSpaceId` as the
 * stored properties report it. A route cannot produce an owner-authorized rent
 * command without having looked the owner up first, so a request can no longer
 * point the authorizing wallet at a player it merely claims owns the space.
 */
export function rentBankingCommand(request: PropertyRentRequest, resolvedOwnerPlayerId: string): RentBankingCommand {
  const command: RentBankingCommand = {
    boardSpaceId: request.boardSpaceId,
    payerPlayerId: request.payerPlayerId,
    ...(request.comment === undefined ? {} : { comment: request.comment }),
    ...(request.diceTotal === undefined ? {} : { diceTotal: request.diceTotal }),
    ...(request.chargedByOwner === true ? { chargedByOwner: true, ownerPlayerId: resolvedOwnerPlayerId } : {}),
  };
  return command;
}

/** Every request that moves money and therefore needs one wallet's controller behind it. */
export type BankingCommandRequest =
  | CreateTransactionRequest
  | BankruptcyRequest
  | JailBailRequest
  | PropertyPurchaseRequest
  | RentBankingCommand
  | PropertyBuildRequest
  | PropertySellBuildingsRequest
  | PropertyMortgageRequest
  | PropertyUnmortgageRequest
  | PropertyAuctionRequest
  | CreateTradeRequest;

/**
 * Every banking command has one wallet whose controller must authorize it.
 * This deliberately describes authority, not the complete set of balances an
 * operation may affect (for example, ALL_TO_PLAYER debits several wallets, and
 * a trade moves both parties' money on the proposer's say-so plus acceptance).
 *
 * Rent is the one command whose authorizing wallet depends on direction: the
 * payer when they pay, the owner when the owner raises the claim. That owner is
 * only ever the one `rentBankingCommand` resolved from the deed, never a value
 * the request supplied.
 */
export function controlledPlayerIdForBankingCommand(request: BankingCommandRequest): string {
  if ('type' in request) return transactionWallet(request);
  if ('proposerPlayerId' in request) return request.proposerPlayerId;
  if ('winnerPlayerId' in request) return request.winnerPlayerId;
  if ('payerPlayerId' in request) return request.ownerPlayerId ?? request.payerPlayerId;
  return request.playerId;
}

function transactionWallet(request: CreateTransactionRequest): string {
  switch (request.type) {
    case 'PLAYER_TO_PLAYER': return request.sourcePlayerId;
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER':
    case 'PASS_GO': return request.playerId;
    case 'PLAYER_TO_ALL': return request.payerPlayerId;
    case 'ALL_TO_PLAYER': return request.recipientPlayerId;
  }
}
