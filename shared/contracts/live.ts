import type { BankruptcyRequest, CreateTransactionRequest, CreateTransactionResponse, GameDetails } from './api.js';
import type { Player, Transaction } from '../types/monopoly.js';

/** Commands are accepted only by the game coordinator, never peer-to-peer. */
export type LiveMutationCommand =
  | { type: 'CREATE_TRANSACTION'; commandId: string; request: CreateTransactionRequest }
  | { type: 'DECLARE_BANKRUPTCY'; commandId: string; request: BankruptcyRequest }
  | { type: 'FINISH_GAME'; commandId: string };

export interface LiveGameState {
  version: number;
  details: GameDetails;
  transactions: Transaction[];
}

export type LiveServerEvent =
  | { type: 'GAME_STATE'; state: LiveGameState }
  | { type: 'TRANSACTION_CREATED'; version: number; transaction: Transaction }
  | { type: 'BALANCES_UPDATED'; version: number; players: Player[] }
  | { type: 'PLAYER_BANKRUPT'; version: number; playerId: string; players: Player[] }
  | { type: 'GAME_FINISHED'; version: number; details: GameDetails }
  | { type: 'LOBBY_UPDATED'; version: number; details: Pick<GameDetails, 'game' | 'players'> }
  | { type: 'MEMBER_JOINED'; version: number; connectedMembers: number };

export type LiveMutationResponse = CreateTransactionResponse | GameDetails;

export function isLiveMutationCommand(value: unknown): value is LiveMutationCommand {
  if (value === null || typeof value !== 'object' || !('type' in value) || !('commandId' in value)) return false;
  const command = value as { type?: unknown; commandId?: unknown };
  return typeof command.commandId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.commandId)
    && (command.type === 'CREATE_TRANSACTION' || command.type === 'DECLARE_BANKRUPTCY' || command.type === 'FINISH_GAME');
}

export function isLiveServerEvent(value: unknown): value is LiveServerEvent {
  return value !== null && typeof value === 'object' && 'type' in value && typeof (value as { type?: unknown }).type === 'string';
}
