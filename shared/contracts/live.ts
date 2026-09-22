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
  PropertyBuildRequest,
  PropertyMortgageRequest,
  PropertyOperationResponse,
  PropertyPurchaseRequest,
  PropertyRentRequest,
  PropertySellBuildingsRequest,
  PropertyUnmortgageRequest,
  TradeActionResponse,
} from './api.js';
import type { Player, Transaction } from '../types/monopoly.js';

/**
 * The property operations a single `PROPERTY_OPERATION` command can carry. Rent
 * travels as the wire request only: the owner who may authorize a claim is
 * resolved from the stored deed by whoever executes the command, never trusted
 * from the payload.
 */
export type PropertyOperation =
  | { operation: 'PURCHASE'; request: PropertyPurchaseRequest }
  | { operation: 'RENT'; request: PropertyRentRequest }
  | { operation: 'BUILD'; request: PropertyBuildRequest }
  | { operation: 'SELL_BUILDINGS'; request: PropertySellBuildingsRequest }
  | { operation: 'MORTGAGE'; request: PropertyMortgageRequest }
  | { operation: 'UNMORTGAGE'; request: PropertyUnmortgageRequest };

/** The intersection distributes over the union, so `operation` still narrows `request`. */
export type PropertyOperationCommand = PropertyOperation & { type: 'PROPERTY_OPERATION'; commandId: string };

export type PropertyOperationKind = PropertyOperation['operation'];
export const propertyOperationKinds = ['PURCHASE', 'RENT', 'BUILD', 'SELL_BUILDINGS', 'MORTGAGE', 'UNMORTGAGE'] as const satisfies readonly PropertyOperationKind[];

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

export type LiveServerEvent =
  | { type: 'GAME_SNAPSHOT'; state: LiveGameState }
  | { type: 'GAME_COMMITTED'; stateVersion: number; transaction: Transaction; players: Player[]; bankruptPlayerId?: string }
  | { type: 'GAME_FINISHED'; stateVersion: number; details: GameDetails }
  | { type: 'LOBBY_UPDATED'; stateVersion: number; details: Pick<GameDetails, 'game' | 'players'> }
  | { type: 'PAYMENT_REQUESTS_UPDATED'; stateVersion: number }
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
      return isRecord(value.request) && typeof value.operation === 'string' && (propertyOperationKinds as readonly string[]).includes(value.operation);
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
  if (value.type === 'GAME_COMMITTED') return isRecord(value.transaction) && Array.isArray(value.players);
  if (value.type === 'GAME_FINISHED') return isRecord(value.details);
  if (value.type === 'LOBBY_UPDATED') return isRecord(value.details) && isRecord(value.details.game) && Array.isArray(value.details.players);
  if (value.type === 'PRESENCE_UPDATED') return isNonNegativeInteger(value.connectedActors);
  return value.type === 'PAYMENT_REQUESTS_UPDATED' || value.type === 'HEARTBEAT';
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function isVersion(value: unknown): value is number { return isNonNegativeInteger(value); }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
