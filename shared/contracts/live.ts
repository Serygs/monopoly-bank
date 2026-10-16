import type {
  BankruptcyRequest,
  AuctionResponse,
  CreateBankingCommandResponse,
  PlaceBidRequest,
  StartAuctionRequest,
  CreateTransactionRequest,
  GameDetails,
  PaymentRequestActionResponse,
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
  /** The auction started, got a bid or closed (a closed sale also sends GAME_COMMITTED). */
  | { type: 'AUCTION_UPDATED'; stateVersion: number; auction: Auction | null }
  | { type: 'PRESENCE_UPDATED'; stateVersion: number; connectedActors: number }
  | { type: 'HEARTBEAT'; stateVersion: number };

export type LiveMutationResponse =
  CreateBankingCommandResponse | PaymentRequestActionResponse | AuctionResponse | GameDetails;

export function isLiveMutationCommand(value: unknown): value is LiveMutationCommand {
  if (value === null || typeof value !== 'object' || !('type' in value) || !('commandId' in value))
    return false;
  const command = value as { type?: unknown; commandId?: unknown };
  return (
    typeof command.commandId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      command.commandId,
    ) &&
    (command.type === 'CREATE_TRANSACTION' ||
      command.type === 'DECLARE_BANKRUPTCY' ||
      command.type === 'FINISH_GAME' ||
      command.type === 'ACCEPT_PAYMENT_REQUEST' ||
      command.type === 'DECLINE_PAYMENT_REQUEST' ||
      command.type === 'CANCEL_PAYMENT_REQUEST' ||
      command.type === 'START_GAME' ||
      command.type === 'JOIN_LOBBY' ||
      command.type === 'REMOVE_PLAYER' ||
      command.type === 'START_AUCTION' ||
      command.type === 'PLACE_BID') &&
    (command.type === 'CREATE_TRANSACTION' || command.type === 'DECLARE_BANKRUPTCY'
      ? 'request' in value
      : command.type === 'START_AUCTION'
        ? isStartAuctionRequest((value as { request?: unknown }).request)
        : command.type === 'PLACE_BID'
          ? isPlaceBidRequest((value as { request?: unknown }).request)
          : command.type === 'FINISH_GAME'
            ? Array.isArray((value as { winnerPlayerIds?: unknown }).winnerPlayerIds) &&
              ((value as { winnerPlayerIds?: unknown[] }).winnerPlayerIds ?? []).every(
                (id) => typeof id === 'string',
              )
            : command.type === 'START_GAME'
              ? true
              : command.type === 'REMOVE_PLAYER'
                ? typeof (value as { playerId?: unknown }).playerId === 'string'
                : command.type === 'JOIN_LOBBY'
                  ? typeof (value as { playerId?: unknown }).playerId === 'string' &&
                    typeof (value as { nickname?: unknown }).nickname === 'string' &&
                    typeof (value as { color?: unknown }).color === 'string' &&
                    typeof (value as { startingBalance?: unknown }).startingBalance === 'number'
                  : typeof (value as { paymentRequestId?: unknown }).paymentRequestId === 'string')
  );
}

export function isLiveServerEvent(value: unknown): value is LiveServerEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'GAME_SNAPSHOT')
    return (
      isRecord(value.state) &&
      isVersion(value.state.stateVersion) &&
      Array.isArray(value.state.transactions) &&
      isRecord(value.state.details)
    );
  if (!isVersion(value.stateVersion)) return false;
  if (value.type === 'GAME_COMMITTED')
    return isRecord(value.transaction) && Array.isArray(value.players);
  if (value.type === 'GAME_FINISHED') return isRecord(value.details);
  if (value.type === 'LOBBY_UPDATED')
    return (
      isRecord(value.details) &&
      isRecord(value.details.game) &&
      Array.isArray(value.details.players)
    );
  if (value.type === 'AUCTION_UPDATED') return value.auction === null || isRecord(value.auction);
  if (value.type === 'PRESENCE_UPDATED') return isNonNegativeInteger(value.connectedActors);
  return value.type === 'PAYMENT_REQUESTS_UPDATED' || value.type === 'HEARTBEAT';
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
