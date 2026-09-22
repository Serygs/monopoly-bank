import type {
  BankruptcyRequest,
  CreateBankingCommandResponse,
  CreateTradeRequest,
  CreateTransactionRequest,
  CreateTransactionResponse,
  DiceRollRequest,
  DiceRollResponse,
  GameDetails,
  JailBailRequest,
  PaymentRequestActionResponse,
  PropertyAuctionRequest,
  PropertyBuildRequest,
  PropertyMortgageRequest,
  PropertyOperationResponse,
  PropertyPurchaseRequest,
  PropertyRentRequest,
  PropertySellBuildingsRequest,
  PropertyUnmortgageRequest,
  TradeActionResponse,
} from './api.js';
import type { BuildingBank, GameProperty, Player, Transaction } from '../types/monopoly.js';

/**
 * The property operations a single `PROPERTY_OPERATION` command can carry. Rent
 * travels as the wire request only: the owner who may authorize a claim is
 * resolved from the stored deed by whoever executes the command, never trusted
 * from the payload. An auction is the bank selling a deed nobody bought at the
 * catalogue price; its request names the winner and the agreed price.
 */
export type PropertyOperation =
  | { operation: 'PURCHASE'; request: PropertyPurchaseRequest }
  | { operation: 'RENT'; request: PropertyRentRequest }
  | { operation: 'BUILD'; request: PropertyBuildRequest }
  | { operation: 'SELL_BUILDINGS'; request: PropertySellBuildingsRequest }
  | { operation: 'MORTGAGE'; request: PropertyMortgageRequest }
  | { operation: 'UNMORTGAGE'; request: PropertyUnmortgageRequest }
  | { operation: 'AUCTION'; request: PropertyAuctionRequest };

/** The intersection distributes over the union, so `operation` still narrows `request`. */
export type PropertyOperationCommand = PropertyOperation & { type: 'PROPERTY_OPERATION'; commandId: string };

export type PropertyOperationKind = PropertyOperation['operation'];
export const propertyOperationKinds = ['PURCHASE', 'RENT', 'BUILD', 'SELL_BUILDINGS', 'MORTGAGE', 'UNMORTGAGE', 'AUCTION'] as const satisfies readonly PropertyOperationKind[];

/** One player's jail flag after a commit; carried on `GAME_COMMITTED` so a client need not diff `players`. */
export interface JailChange { playerId: string; isInJail: boolean; }

export type TradeResolution = 'accept' | 'decline' | 'cancel';
export const tradeResolutions = ['accept', 'decline', 'cancel'] as const satisfies readonly TradeResolution[];

/** Commands are accepted only by the game coordinator, never peer-to-peer. */
export type LiveMutationCommand =
  | { type: 'CREATE_TRANSACTION'; commandId: string; request: CreateTransactionRequest }
  | { type: 'ACCEPT_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'DECLINE_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'CANCEL_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'DECLARE_BANKRUPTCY'; commandId: string; request: BankruptcyRequest }
  | { type: 'START_GAME'; commandId: string }
  | { type: 'JOIN_LOBBY'; commandId: string; playerId: string; nickname: string; color: string; startingBalance: number }
  | { type: 'FINISH_GAME'; commandId: string; winnerPlayerIds: string[] }
  | PropertyOperationCommand
  | { type: 'PROPOSE_TRADE'; commandId: string; request: CreateTradeRequest }
  | { type: 'RESOLVE_TRADE'; commandId: string; tradeId: string; action: TradeResolution }
  | { type: 'JAIL_BAIL'; commandId: string; request: JailBailRequest }
  | { type: 'DICE_ROLL'; commandId: string; request: DiceRollRequest };

export interface LiveGameState {
  stateVersion: number;
  details: GameDetails;
  transactions: Transaction[];
}

/**
 * `GAME_COMMITTED` carries the board fields only when the commit touched the
 * board. `properties` lists the deed rows the commit changed, never the whole
 * catalogue; a client merges them by `boardSpaceId` and can always rebuild the
 * full state from a fresh `GAME_SNAPSHOT`. A plain money move omits all three,
 * so clients written before the board subsystem keep reading the event as before.
 */
export type LiveServerEvent =
  | { type: 'GAME_SNAPSHOT'; state: LiveGameState }
  | { type: 'GAME_COMMITTED'; stateVersion: number; transaction: Transaction; players: Player[]; bankruptPlayerId?: string; properties?: GameProperty[]; buildingBank?: BuildingBank; jailChanges?: JailChange[] }
  | { type: 'GAME_FINISHED'; stateVersion: number; details: GameDetails }
  | { type: 'LOBBY_UPDATED'; stateVersion: number; details: Pick<GameDetails, 'game' | 'players'> }
  | { type: 'PAYMENT_REQUESTS_UPDATED'; stateVersion: number }
  /** The offer list changed (proposed, accepted, declined or cancelled); the client re-reads `GET …/trades`. */
  | { type: 'TRADES_UPDATED'; stateVersion: number }
  /** A roll was recorded; `player` is the roller's fresh row, including the jail flag a third double sets. */
  | { type: 'DICE_ROLLED'; stateVersion: number; player: Player; thirdDouble: boolean }
  | { type: 'PRESENCE_UPDATED'; stateVersion: number; connectedActors: number }
  | { type: 'HEARTBEAT'; stateVersion: number };

export type LiveMutationResponse =
  | CreateBankingCommandResponse
  | PaymentRequestActionResponse
  | GameDetails
  | PropertyOperationResponse
  | TradeActionResponse
  | CreateTransactionResponse
  | DiceRollResponse;

const commandIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * A structural check only: it confirms the envelope names a known command and
 * carries the fields that command needs. Field contents are validated by the
 * API parsers before the command is built, and authority is checked by the
 * coordinator before it is executed.
 */
export function isLiveMutationCommand(value: unknown): value is LiveMutationCommand {
  if (!isRecord(value) || typeof value.commandId !== 'string' || !commandIdPattern.test(value.commandId)) return false;
  switch (value.type) {
    case 'CREATE_TRANSACTION':
    case 'DECLARE_BANKRUPTCY':
    case 'PROPOSE_TRADE':
    case 'JAIL_BAIL':
    case 'DICE_ROLL':
      return isRecord(value.request);
    case 'PROPERTY_OPERATION':
      if (!isRecord(value.request) || typeof value.operation !== 'string' || !(propertyOperationKinds as readonly string[]).includes(value.operation)) return false;
      // An auction is the one operation whose envelope must name its two extra fields: a bare request cannot be a bid.
      return value.operation !== 'AUCTION' || (typeof value.request.winnerPlayerId === 'string' && typeof value.request.price === 'number');
    case 'RESOLVE_TRADE':
      return typeof value.tradeId === 'string' && typeof value.action === 'string' && (tradeResolutions as readonly string[]).includes(value.action);
    case 'FINISH_GAME':
      return Array.isArray(value.winnerPlayerIds) && value.winnerPlayerIds.every((id) => typeof id === 'string');
    case 'START_GAME':
      return true;
    case 'JOIN_LOBBY':
      return typeof value.playerId === 'string' && typeof value.nickname === 'string' && typeof value.color === 'string' && typeof value.startingBalance === 'number';
    case 'ACCEPT_PAYMENT_REQUEST':
    case 'DECLINE_PAYMENT_REQUEST':
    case 'CANCEL_PAYMENT_REQUEST':
      return typeof value.paymentRequestId === 'string';
    default:
      return false;
  }
}

export function isLiveServerEvent(value: unknown): value is LiveServerEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'GAME_SNAPSHOT') return isRecord(value.state) && isVersion(value.state.stateVersion) && Array.isArray(value.state.transactions) && isRecord(value.state.details);
  if (!isVersion(value.stateVersion)) return false;
  if (value.type === 'GAME_COMMITTED') return isRecord(value.transaction) && Array.isArray(value.players) && (value.properties === undefined || Array.isArray(value.properties)) && (value.jailChanges === undefined || Array.isArray(value.jailChanges));
  if (value.type === 'GAME_FINISHED') return isRecord(value.details);
  if (value.type === 'LOBBY_UPDATED') return isRecord(value.details) && isRecord(value.details.game) && Array.isArray(value.details.players);
  if (value.type === 'PRESENCE_UPDATED') return isNonNegativeInteger(value.connectedActors);
  if (value.type === 'DICE_ROLLED') return isRecord(value.player) && typeof value.thirdDouble === 'boolean';
  return value.type === 'PAYMENT_REQUESTS_UPDATED' || value.type === 'TRADES_UPDATED' || value.type === 'HEARTBEAT';
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function isVersion(value: unknown): value is number { return isNonNegativeInteger(value); }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
