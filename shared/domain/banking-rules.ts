import type { Game, Player, TransactionParticipant, TransactionType } from '../types/monopoly.js';
import { AppError } from '../../worker/services/errors.js';

/**
 * The rules every money-moving operation shares: what a playable game looks
 * like, what counts as an amount, and the shape of a result. Banking, property,
 * trade and jail operations all build on this module, so the player-count,
 * balance and rounding rules exist exactly once.
 *
 * `banking.ts` re-exports this module's public surface, so every importer that
 * predates the split keeps working unchanged.
 */

/** The slice of the world every operation needs before it can touch a wallet. */
export interface BankingCommand {
  game: Game;
  players: readonly Player[];
  comment?: string | null;
}

export interface BankingOperationResult {
  transaction: PendingTransaction;
  affectedPlayers: PlayerBalanceChange[];
}

export interface PendingTransaction {
  gameId: string;
  type: TransactionType;
  amount: number;
  totalAmount: number;
  comment: string | null;
  participants: TransactionParticipant[];
}

export interface PlayerBalanceChange {
  player: Player;
  balanceBefore: number;
  balanceAfter: number;
  balanceDelta: number;
}

export type BankingErrorCode =
  | 'INVALID_AMOUNT'
  | 'PLAYER_NOT_FOUND'
  | 'SAME_SOURCE_AND_DESTINATION'
  | 'INSUFFICIENT_FUNDS'
  | 'GAME_FINISHED'
  | 'PLAYER_BANKRUPT';

export abstract class BankingDomainError extends AppError {}

export class InvalidAmountError extends BankingDomainError {
  readonly code = 'INVALID_AMOUNT' as const;
  readonly amount: number;

  constructor(amount: number) {
    super({ code: 'INVALID_AMOUNT', message: 'Amount must be a positive safe integer.', status: 400, details: { field: 'amount' } });
    this.amount = amount;
  }
}

export class PlayerNotFoundError extends BankingDomainError {
  readonly code = 'PLAYER_NOT_FOUND' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super({ code: 'PLAYER_NOT_FOUND', message: 'Player not found.', status: 404 });
    this.playerId = playerId;
  }
}

export class SameSourceAndDestinationError extends BankingDomainError {
  readonly code = 'SAME_SOURCE_AND_DESTINATION' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super({ code: 'SAME_SOURCE_AND_DESTINATION', message: 'The source and destination players must be different.', status: 400 });
    this.playerId = playerId;
  }
}

export class InsufficientFundsError extends BankingDomainError {
  readonly code = 'INSUFFICIENT_FUNDS' as const;
  readonly playerId: string;
  readonly currentBalance: number;
  readonly requiredAmount: number;
  readonly shortfall: number;

  constructor(
    playerId: string,
    currentBalance: number,
    requiredAmount: number,
  ) {
    super({ code: 'INSUFFICIENT_FUNDS', message: 'Player does not have enough funds.', status: 409, details: { playerId, currentBalance, requiredAmount, shortfall: requiredAmount - currentBalance } });
    this.playerId = playerId;
    this.currentBalance = currentBalance;
    this.requiredAmount = requiredAmount;
    this.shortfall = requiredAmount - currentBalance;
  }
}

export class InvalidGameStateError extends BankingDomainError {
  readonly code = 'GAME_FINISHED' as const;
  readonly reason: string;

  constructor(reason: string) {
    super({ code: 'GAME_FINISHED', message: 'This game is finished.', status: 409 });
    this.reason = reason;
  }
}

export class PlayerBankruptError extends BankingDomainError {
  readonly code = 'PLAYER_BANKRUPT' as const;
  constructor(playerId: string) { super({ code: 'PLAYER_BANKRUPT', message: 'This player is bankrupt.', status: 409, details: { playerId } }); }
}

export function validateGame(game: Game, players: readonly Player[]): readonly Player[] {
  if (game.status !== 'ACTIVE') {
    throw new InvalidGameStateError(`game status is ${game.status}`);
  }

  if (players.length < 2 || players.length > 6) {
    throw new InvalidGameStateError('a game must contain between 2 and 6 players');
  }

  const playerIds = new Set<string>();
  for (const player of players) {
    if (player.gameId !== game.id) {
      throw new InvalidGameStateError(`player "${player.id}" belongs to another game`);
    }
    if (!Number.isSafeInteger(player.balance) || player.balance < 0) {
      throw new InvalidGameStateError(`player "${player.id}" has an invalid balance`);
    }
    if (playerIds.has(player.id)) {
      throw new InvalidGameStateError(`player "${player.id}" appears more than once`);
    }
    playerIds.add(player.id);
  }

  return players;
}

export function validateAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidAmountError(amount);
  }
}

export function findPlayer(players: readonly Player[], playerId: string): Player {
  const player = players.find((candidate) => candidate.id === playerId);
  if (player === undefined) {
    throw new PlayerNotFoundError(playerId);
  }
  return player;
}

export function ensureDifferentPlayers(source: Player, destination: Player): void {
  if (source.id === destination.id) {
    throw new SameSourceAndDestinationError(source.id);
  }
}

export function ensureSufficientFunds(player: Player, requiredAmount: number): void {
  if (player.balance < requiredAmount) {
    throw new InsufficientFundsError(player.id, player.balance, requiredAmount);
  }
}

export function ensureActive(player: Player): void {
  if (player.status === 'BANKRUPT') {
    throw new PlayerBankruptError(player.id);
  }
}

/** A product that must stay inside the safe-integer range; zero is allowed (nobody to pay). */
export function multiplyAmounts(amount: number, multiplier: number): number {
  const totalAmount = amount * multiplier;
  if (!Number.isSafeInteger(totalAmount)) {
    throw new InvalidAmountError(totalAmount);
  }
  return totalAmount;
}

/** The same product where zero is not a valid answer, because it is a price. */
export function multiplyPositiveAmounts(amount: number, multiplier: number): number {
  const totalAmount = multiplyAmounts(amount, multiplier);
  validateAmount(totalAmount);
  return totalAmount;
}

export function createBalanceChange(player: Player, balanceDelta: number): PlayerBalanceChange {
  const balanceAfter = player.balance + balanceDelta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new InvalidGameStateError(`operation would produce an invalid balance for player "${player.id}"`);
  }

  return {
    player,
    balanceBefore: player.balance,
    balanceAfter,
    balanceDelta,
  };
}

export function createResult(
  gameId: string,
  type: TransactionType,
  amount: number,
  totalAmount: number,
  comment: string | null | undefined,
  affectedPlayers: PlayerBalanceChange[],
): BankingOperationResult {
  return {
    transaction: {
      gameId,
      type,
      amount,
      totalAmount,
      comment: comment ?? null,
      participants: affectedPlayers.map(({ player, balanceDelta }) => ({
        playerId: player.id,
        balanceDelta,
      })),
    },
    affectedPlayers,
  };
}
