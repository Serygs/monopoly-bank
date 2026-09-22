import type { BoardDefinition } from '../types/monopoly.js';
import {
  BankingDomainError,
  createBalanceChange,
  createResult,
  ensureActive,
  ensureSufficientFunds,
  findPlayer,
  validateAmount,
  validateGame,
  type BankingCommand,
  type BankingOperationResult,
} from './banking-rules.js';

/**
 * Jail has two halves and they live together here. The three-doubles rule is
 * what puts a player in, and it is the client's dice roller that applies it, so
 * it is shared domain rather than a client utility — `src/utils/dice.ts`
 * re-exports it so there is exactly one copy of the rule. Bail is what takes a
 * player out, and that is an ordinary payment to the bank.
 */

export interface DiceRoll {
  first: number;
  second: number;
  total: number;
  isDouble: boolean;
}

export interface DoublesState {
  consecutiveDoubles: number;
  isInJail: boolean;
  thirdDouble: boolean;
}

export interface PayJailBailCommand extends BankingCommand {
  board: BoardDefinition;
  playerId: string;
}

export interface JailBailResult extends BankingOperationResult {
  /** The jail flag the persisted operation must write alongside the payment. */
  jailChange: { playerId: string; isInJail: boolean };
}

export type JailErrorCode = 'PLAYER_NOT_IN_JAIL';

export class PlayerNotInJailError extends BankingDomainError {
  readonly code = 'PLAYER_NOT_IN_JAIL' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super({ code: 'PLAYER_NOT_IN_JAIL', message: 'This player is not in jail.', status: 409, details: { playerId } });
    this.playerId = playerId;
  }
}

/**
 * The three-doubles rule: a non-double ends the streak, the third consecutive
 * double sends the player to jail and resets it.
 */
export function applyDiceRoll(currentDoubles: number, roll: DiceRoll): DoublesState {
  if (!roll.isDouble) return { consecutiveDoubles: 0, isInJail: false, thirdDouble: false };
  const next = currentDoubles + 1;
  if (next >= 3) return { consecutiveDoubles: 0, isInJail: true, thirdDouble: true };
  return { consecutiveDoubles: next, isInJail: false, thirdDouble: false };
}

/** Buying the way out: the board's jail fee to the bank, and the flag comes off. */
export function payJailBail(command: PayJailBailCommand): JailBailResult {
  const players = validateGame(command.game, command.players);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  if (player.isInJail !== true) {
    throw new PlayerNotInJailError(player.id);
  }

  const fee = command.board.jailFee;
  validateAmount(fee);
  ensureSufficientFunds(player, fee);

  return {
    ...createResult(command.game.id, 'JAIL_BAIL', fee, fee, command.comment, [createBalanceChange(player, -fee)]),
    jailChange: { playerId: player.id, isInJail: false },
  };
}
