import type { Game, Player, TransactionParticipant, TransactionType } from '../types/monopoly.js';

export interface PlayerToPlayerCommand extends BankingCommand {
  sourcePlayerId: string;
  destinationPlayerId: string;
  amount: number;
}

export interface PlayerToBankCommand extends BankingCommand {
  playerId: string;
  amount: number;
}

export interface BankToPlayerCommand extends BankingCommand {
  playerId: string;
  amount: number;
}

export interface PlayerToAllCommand extends BankingCommand {
  payerPlayerId: string;
  amountPerPlayer: number;
}

export interface AllToPlayerCommand extends BankingCommand {
  recipientPlayerId: string;
  amountPerPlayer: number;
}

export interface PassGoCommand {
  game: Game;
  players: readonly Player[];
  playerId: string;
  comment?: string | null;
}

export interface BankruptcyCommand extends BankingCommand {
  playerId: string;
  creditorPlayerId?: string;
}

interface BankingCommand {
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
  | 'INVALID_GAME_STATE';

export abstract class BankingDomainError extends Error {
  abstract readonly code: BankingErrorCode;
}

export class InvalidAmountError extends BankingDomainError {
  readonly code = 'INVALID_AMOUNT' as const;
  readonly amount: number;

  constructor(amount: number) {
    super('Amount must be a positive safe integer.');
    this.amount = amount;
  }
}

export class PlayerNotFoundError extends BankingDomainError {
  readonly code = 'PLAYER_NOT_FOUND' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super(`Player "${playerId}" was not found in the game.`);
    this.playerId = playerId;
  }
}

export class SameSourceAndDestinationError extends BankingDomainError {
  readonly code = 'SAME_SOURCE_AND_DESTINATION' as const;
  readonly playerId: string;

  constructor(playerId: string) {
    super('The source and destination players must be different.');
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
    super(`Player "${playerId}" has insufficient funds.`);
    this.playerId = playerId;
    this.currentBalance = currentBalance;
    this.requiredAmount = requiredAmount;
    this.shortfall = requiredAmount - currentBalance;
  }
}

export class InvalidGameStateError extends BankingDomainError {
  readonly code = 'INVALID_GAME_STATE' as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`The game cannot accept banking operations: ${reason}`);
    this.reason = reason;
  }
}

export function playerToPlayer(command: PlayerToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const source = findPlayer(players, command.sourcePlayerId);
  const destination = findPlayer(players, command.destinationPlayerId);
  ensureActive(source);
  ensureActive(destination);
  ensureDifferentPlayers(source, destination);
  ensureSufficientFunds(source, command.amount);

  return createResult(
    command.game.id,
    'PLAYER_TO_PLAYER',
    command.amount,
    command.amount,
    command.comment,
    [
      createBalanceChange(source, -command.amount),
      createBalanceChange(destination, command.amount),
    ],
  );
}

export function playerToBank(command: PlayerToBankCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureSufficientFunds(player, command.amount);

  return createResult(
    command.game.id,
    'PLAYER_TO_BANK',
    command.amount,
    command.amount,
    command.comment,
    [createBalanceChange(player, -command.amount)],
  );
}

export function bankToPlayer(command: BankToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amount);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  return createResult(
    command.game.id,
    'BANK_TO_PLAYER',
    command.amount,
    command.amount,
    command.comment,
    [createBalanceChange(player, command.amount)],
  );
}

export function playerToAll(command: PlayerToAllCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amountPerPlayer);

  const payer = findPlayer(players, command.payerPlayerId);
  ensureActive(payer);
  const recipients = players.filter((player) => player.id !== payer.id && player.status !== 'BANKRUPT');
  const totalAmount = multiplyAmounts(command.amountPerPlayer, recipients.length);
  ensureSufficientFunds(payer, totalAmount);

  return createResult(
    command.game.id,
    'PLAYER_TO_ALL',
    command.amountPerPlayer,
    totalAmount,
    command.comment,
    [
      createBalanceChange(payer, -totalAmount),
      ...recipients.map((recipient) => createBalanceChange(recipient, command.amountPerPlayer)),
    ],
  );
}

export function allToPlayer(command: AllToPlayerCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.amountPerPlayer);

  const recipient = findPlayer(players, command.recipientPlayerId);
  ensureActive(recipient);
  const payers = players.filter((player) => player.id !== recipient.id && player.status !== 'BANKRUPT');
  for (const payer of payers) {
    ensureSufficientFunds(payer, command.amountPerPlayer);
  }

  const totalAmount = multiplyAmounts(command.amountPerPlayer, payers.length);
  return createResult(
    command.game.id,
    'ALL_TO_PLAYER',
    command.amountPerPlayer,
    totalAmount,
    command.comment,
    [
      ...payers.map((payer) => createBalanceChange(payer, -command.amountPerPlayer)),
      createBalanceChange(recipient, totalAmount),
    ],
  );
}

export function passGo(command: PassGoCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.game.passGoReward);

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  return createResult(
    command.game.id,
    'PASS_GO',
    command.game.passGoReward,
    command.game.passGoReward,
    command.comment,
    [createBalanceChange(player, command.game.passGoReward)],
  );
}

export function declareBankruptcy(command: BankruptcyCommand): BankingOperationResult {
  const players = validateGame(command.game, command.players);
  const bankruptPlayer = findPlayer(players, command.playerId);
  ensureActive(bankruptPlayer);
  const creditor = command.creditorPlayerId === undefined ? null : findPlayer(players, command.creditorPlayerId);
  if (creditor !== null) { ensureActive(creditor); ensureDifferentPlayers(bankruptPlayer, creditor); }
  if (bankruptPlayer.balance === 0) {
    return createResult(command.game.id, 'BANKRUPTCY_TRANSFER', 1, 1, null, []);
  }
  return createResult(command.game.id, 'BANKRUPTCY_TRANSFER', bankruptPlayer.balance, bankruptPlayer.balance, null, [
    createBalanceChange(bankruptPlayer, -bankruptPlayer.balance),
    ...(creditor === null ? [] : [createBalanceChange(creditor, bankruptPlayer.balance)]),
  ]);
}

function validateGame(game: Game, players: readonly Player[]): readonly Player[] {
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

function validateAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidAmountError(amount);
  }
}

function findPlayer(players: readonly Player[], playerId: string): Player {
  const player = players.find((candidate) => candidate.id === playerId);
  if (player === undefined) {
    throw new PlayerNotFoundError(playerId);
  }
  return player;
}

function ensureDifferentPlayers(source: Player, destination: Player): void {
  if (source.id === destination.id) {
    throw new SameSourceAndDestinationError(source.id);
  }
}

function ensureSufficientFunds(player: Player, requiredAmount: number): void {
  if (player.balance < requiredAmount) {
    throw new InsufficientFundsError(player.id, player.balance, requiredAmount);
  }
}

function ensureActive(player: Player): void {
  if (player.status === 'BANKRUPT') {
    throw new InvalidGameStateError(`player "${player.id}" is bankrupt`);
  }
}

function multiplyAmounts(amount: number, multiplier: number): number {
  const totalAmount = amount * multiplier;
  if (!Number.isSafeInteger(totalAmount)) {
    throw new InvalidAmountError(totalAmount);
  }
  return totalAmount;
}

function createBalanceChange(player: Player, balanceDelta: number): PlayerBalanceChange {
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

function createResult(
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
