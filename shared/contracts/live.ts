import type {
  BankruptcyRequest,
  CreateBankingCommandResponse,
  CreateTransactionRequest,
  GameDetails,
  PaymentRequestActionResponse,
} from './api.js';
import type { Player, Transaction } from '../types/monopoly.js';

/** Commands are accepted only by the game coordinator, never peer-to-peer. */
export type LiveMutationCommand =
  | { type: 'CREATE_TRANSACTION'; commandId: string; request: CreateTransactionRequest }
  | { type: 'ACCEPT_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'DECLINE_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'CANCEL_PAYMENT_REQUEST'; commandId: string; paymentRequestId: string }
  | { type: 'DECLARE_BANKRUPTCY'; commandId: string; request: BankruptcyRequest }
  | { type: 'START_GAME'; commandId: string }
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
    }
  | { type: 'GAME_FINISHED'; stateVersion: number; details: GameDetails }
  | { type: 'LOBBY_UPDATED'; stateVersion: number; details: Pick<GameDetails, 'game' | 'players'> }
  | { type: 'PAYMENT_REQUESTS_UPDATED'; stateVersion: number }
  | { type: 'PRESENCE_UPDATED'; stateVersion: number; connectedActors: number }
  | { type: 'HEARTBEAT'; stateVersion: number };

export type LiveMutationResponse =
  CreateBankingCommandResponse | PaymentRequestActionResponse | GameDetails;

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
      command.type === 'JOIN_LOBBY') &&
    (command.type === 'CREATE_TRANSACTION' || command.type === 'DECLARE_BANKRUPTCY'
      ? 'request' in value
      : command.type === 'FINISH_GAME'
        ? Array.isArray((value as { winnerPlayerIds?: unknown }).winnerPlayerIds) &&
          ((value as { winnerPlayerIds?: unknown[] }).winnerPlayerIds ?? []).every(
            (id) => typeof id === 'string',
          )
        : command.type === 'START_GAME'
          ? true
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
  if (value.type === 'PRESENCE_UPDATED') return isNonNegativeInteger(value.connectedActors);
  return value.type === 'PAYMENT_REQUESTS_UPDATED' || value.type === 'HEARTBEAT';
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
