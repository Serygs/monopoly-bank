import type {
  BankruptcyRequest,
  AuctionResponse,
  CreateBankingCommandResponse,
  PlaceBidRequest,
  StartAuctionRequest,
  CreateTransactionRequest,
  GameDetails,
  PaymentRequestActionResponse,
  CreateTradeRequestBody,
  CreateTradeRequestResponse,
  TradeRequestActionResponse,
} from './api.js';
import type {
  GameProperty,
  Auction,
  BankLoanCooldown,
  Loan,
  Mortgage,
  Player,
  Transaction,
} from '../types/monopoly.js';

/** Commands are accepted only by the game coordinator, never peer-to-peer. */
export type LiveMutationCommand =
  | { type: 'CREATE_TRANSACTION'; commandId: string; request: CreateTransactionRequest }
  | { type: 'ACCEPT_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'DECLINE_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'CANCEL_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'CREATE_TRADE_REQUEST'; commandId: string; request: CreateTradeRequestBody }
  | { type: 'ACCEPT_TRADE_REQUEST'; commandId: string; tradeRequestId: string }
  | { type: 'DECLINE_TRADE_REQUEST'; commandId: string; tradeRequestId: string }
  | { type: 'CANCEL_TRADE_REQUEST'; commandId: string; tradeRequestId: string }
  | { type: 'DECLARE_BANKRUPTCY'; commandId: string; request: BankruptcyRequest }
  | { type: 'START_AUCTION'; commandId: string; request: StartAuctionRequest }
  | { type: 'PLACE_BID'; commandId: string; request: PlaceBidRequest }
  | { type: 'START_GAME'; commandId: string }
  | { type: 'REMOVE_PLAYER'; commandId: string; playerId: string }
  | {
      type: 'JOIN_LOBBY';
      commandId: string;
      playerId: string;
      nickname: string;
      color: string;
      startingBalance: number;
    }
  | { type: 'FINISH_GAME'; commandId: string; winnerPlayerIds: string[] };

export interface LiveGameState {
  stateVersion: number;
  details: GameDetails;
  transactions: Transaction[];
}

export type LiveServerEvent =
  | { type: 'GAME_SNAPSHOT'; state: LiveGameState }
  | {
      type: 'GAME_COMMITTED';
      stateVersion: number;
      transaction: Transaction;
      players: Player[];
      bankruptPlayerId?: string;
      /** The active mortgages after a mortgage, a redemption or a bankruptcy. */
      mortgages?: Mortgage[];
      /** The loans still being repaid after a loan is issued or repaid, or a bankruptcy. */
      loans?: Loan[];
      /** With the bank-loans rule, every commit carries the loans and cooldowns (rounds may advance). */
      bankLoanCooldowns?: BankLoanCooldown[];
      /** The Free Parking pot after the commit; present whenever the game has the jackpot rule. */
      jackpot?: number;
      /** Board games: the registry rows this commit changed (merge by tileId). */
      properties?: GameProperty[];
    }
  | { type: 'GAME_FINISHED'; stateVersion: number; details: GameDetails }
  | { type: 'LOBBY_UPDATED'; stateVersion: number; details: Pick<GameDetails, 'game' | 'players'> }
  | { type: 'PAYMENT_REQUESTS_UPDATED'; stateVersion: number }
  | { type: 'TRADE_REQUESTS_UPDATED'; stateVersion: number }
  /** The auction started, got a bid or closed (a closed sale also sends GAME_COMMITTED). */
  | { type: 'AUCTION_UPDATED'; stateVersion: number; auction: Auction | null }
  | { type: 'PRESENCE_UPDATED'; stateVersion: number; connectedActors: number }
  | { type: 'HEARTBEAT'; stateVersion: number };

export interface GameVersionResponse {
  stateVersion: number;
}

export type LiveMutationResponse =
  | CreateBankingCommandResponse
  | PaymentRequestActionResponse
  | CreateTradeRequestResponse
  | TradeRequestActionResponse
  | AuctionResponse
  | GameDetails;

const COMMAND_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type CommandBodyCheck = (value: Record<string, unknown>) => boolean;

const hasRequest: CommandBodyCheck = (value) => 'request' in value;
const hasString =
  (...keys: string[]): CommandBodyCheck =>
  (value) =>
    keys.every((key) => typeof value[key] === 'string');

const COMMAND_BODY_CHECKS: Record<LiveMutationCommand['type'], CommandBodyCheck> = {
  CREATE_TRANSACTION: hasRequest,
  DECLARE_BANKRUPTCY: hasRequest,
  CREATE_TRADE_REQUEST: hasRequest,
  START_AUCTION: (value) => isStartAuctionRequest(value.request),
  PLACE_BID: (value) => isPlaceBidRequest(value.request),
  FINISH_GAME: (value) =>
    Array.isArray(value.winnerPlayerIds) &&
    (value.winnerPlayerIds as unknown[]).every((id) => typeof id === 'string'),
  START_GAME: () => true,
  REMOVE_PLAYER: hasString('playerId'),
  JOIN_LOBBY: (value) =>
    hasString('playerId', 'nickname', 'color')(value) && typeof value.startingBalance === 'number',
  ACCEPT_TRADE_REQUEST: hasString('tradeRequestId'),
  DECLINE_TRADE_REQUEST: hasString('tradeRequestId'),
  CANCEL_TRADE_REQUEST: hasString('tradeRequestId'),
  ACCEPT_PAYMENT_REQUEST: hasString('paymentRequestId'),
  DECLINE_PAYMENT_REQUEST: hasString('paymentRequestId'),
  CANCEL_PAYMENT_REQUEST: hasString('paymentRequestId'),
};

export function isLiveMutationCommand(value: unknown): value is LiveMutationCommand {
  if (!isRecord(value) || !('type' in value) || !('commandId' in value)) return false;
  const { type, commandId } = value;
  if (typeof commandId !== 'string' || !COMMAND_ID_PATTERN.test(commandId)) return false;
  if (typeof type !== 'string' || !Object.hasOwn(COMMAND_BODY_CHECKS, type)) return false;
  return COMMAND_BODY_CHECKS[type as LiveMutationCommand['type']](value);
}

type EventBodyCheck = (value: Record<string, unknown>) => boolean;

const EVENT_BODY_CHECKS: Record<
  Exclude<LiveServerEvent['type'], 'GAME_SNAPSHOT'>,
  EventBodyCheck
> = {
  GAME_COMMITTED: (value) => isRecord(value.transaction) && Array.isArray(value.players),
  GAME_FINISHED: (value) => isRecord(value.details),
  LOBBY_UPDATED: (value) =>
    isRecord(value.details) && isRecord(value.details.game) && Array.isArray(value.details.players),
  AUCTION_UPDATED: (value) => value.auction === null || isRecord(value.auction),
  PRESENCE_UPDATED: (value) => isNonNegativeInteger(value.connectedActors),
  PAYMENT_REQUESTS_UPDATED: () => true,
  TRADE_REQUESTS_UPDATED: () => true,
  HEARTBEAT: () => true,
};

export function isLiveServerEvent(value: unknown): value is LiveServerEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'GAME_SNAPSHOT')
    return (
      isRecord(value.state) &&
      isVersion(value.state.stateVersion) &&
      Array.isArray(value.state.transactions) &&
      isRecord(value.state.details)
    );
  if (!isVersion(value.stateVersion) || !Object.hasOwn(EVENT_BODY_CHECKS, value.type)) return false;
  return EVENT_BODY_CHECKS[value.type as keyof typeof EVENT_BODY_CHECKS](value);
}

function isStartAuctionRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.initiatorPlayerId === 'string' &&
    (value.tileId === undefined || typeof value.tileId === 'string') &&
    (typeof value.lotName === 'string' || typeof value.tileId === 'string')
  );
}
function isPlaceBidRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.bidderPlayerId === 'string' &&
    typeof value.auctionId === 'string' &&
    typeof value.step === 'number' &&
    Number.isSafeInteger(value.step) &&
    typeof value.expectedVersion === 'number' &&
    Number.isSafeInteger(value.expectedVersion)
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
function isVersion(value: unknown): value is number {
  return isNonNegativeInteger(value);
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
