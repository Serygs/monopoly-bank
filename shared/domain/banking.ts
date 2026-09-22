import type { BoardDefinition, BoardSpace, BuildingBank, GameProperty, Player } from '../types/monopoly.js';
import {
  BankingDomainError,
  createBalanceChange,
  createResult,
  ensureActive,
  ensureDifferentPlayers,
  ensureSufficientFunds,
  findPlayer,
  multiplyAmounts,
  validateAmount,
  validateGame,
  type BankingCommand,
  type BankingOperationResult,
} from './banking-rules.js';
import {
  buildingBankDeltaBetween,
  buildingSaleProceeds,
  findBoardSpace,
  type BuildingBankDelta,
  type PropertyChange,
} from './property.js';

/**
 * The shared rules, the error classes and the result types live in
 * `banking-rules.ts` so property, trade and jail operations can reuse them
 * without importing this module. They are re-exported here unchanged: every
 * importer that predates the split keeps its import path.
 */
export {
  BankingDomainError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  PlayerBankruptError,
  PlayerNotFoundError,
  SameSourceAndDestinationError,
} from './banking-rules.js';
export type {
  BankingErrorCode,
  BankingOperationResult,
  PendingTransaction,
  PlayerBalanceChange,
} from './banking-rules.js';

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

export interface PassGoCommand extends BankingCommand {
  playerId: string;
}

/**
 * The four board fields travel together and are all optional: a game that never
 * opted into a board passes none of them and keeps the pre-board behaviour, down
 * to the `balance === 0` placeholder transaction. `spaces` and `properties` are
 * the estate, and they are all-or-nothing: one without the other is refused with
 * `IncompleteEstateError` rather than settled as an empty estate.
 *
 * `board` and `buildingBank` are accepted so a caller can spread the same board
 * slice it passes to every other property operation, but neither is read: a
 * bankruptcy charges no mortgage interest (the deed moves still mortgaged) and
 * only ever hands buildings back, so it can never exhaust the bank.
 */
export interface BankruptcyCommand extends BankingCommand {
  playerId: string;
  creditorPlayerId?: string;
  board?: BoardDefinition;
  spaces?: readonly BoardSpace[];
  properties?: readonly GameProperty[];
  buildingBank?: BuildingBank;
}

/**
 * A bankruptcy handed only half of what it needs to settle an estate. Dropping
 * the estate silently would report a successful bankruptcy while leaving every
 * deed with the bankrupt player, so the incomplete command is refused instead.
 */
export class IncompleteEstateError extends BankingDomainError {
  readonly code = 'INCOMPLETE_ESTATE' as const;
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super({ code: 'INCOMPLETE_ESTATE', message: 'The estate of a bankruptcy needs both the board spaces and the properties.', status: 400, details: { missing: [...missing] } });
    this.missing = missing;
  }
}

export interface BankruptcyResult extends BankingOperationResult {
  propertyChanges: PropertyChange[];
  buildingBankDelta: BuildingBankDelta;
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

/**
 * Canonical bankruptcy. The estate is liquidated first — every building the
 * bankrupt still owns goes back to the bank at half its house cost — and the
 * proceeds ride along with the cash. With a creditor the deeds change hands
 * keeping their mortgage state; without one they are released to nobody, which
 * is what lets the table auction them afterwards.
 */
export function declareBankruptcy(command: BankruptcyCommand): BankruptcyResult {
  const players = validateGame(command.game, command.players);
  const bankruptPlayer = findPlayer(players, command.playerId);
  ensureActive(bankruptPlayer);
  const creditor = command.creditorPlayerId === undefined ? null : findPlayer(players, command.creditorPlayerId);
  if (creditor !== null) { ensureActive(creditor); ensureDifferentPlayers(bankruptPlayer, creditor); }

  const estate = liquidateEstate(command, bankruptPlayer, creditor);
  const transferred = bankruptPlayer.balance + estate.proceeds;
  if (transferred === 0) {
    return { ...createResult(command.game.id, 'BANKRUPTCY_TRANSFER', 1, 1, null, []), ...estate.settlement };
  }

  // A bankrupt holding nothing but buildings ends with a zero cash delta, and a
  // participant row of zero is not a thing the ledger stores.
  const affectedPlayers = [
    createBalanceChange(bankruptPlayer, -bankruptPlayer.balance),
    ...(creditor === null ? [] : [createBalanceChange(creditor, transferred)]),
  ].filter((change) => change.balanceDelta !== 0);

  return {
    ...createResult(command.game.id, 'BANKRUPTCY_TRANSFER', transferred, transferred, null, affectedPlayers),
    ...estate.settlement,
  };
}

interface EstateLiquidation {
  proceeds: number;
  settlement: { propertyChanges: PropertyChange[]; buildingBankDelta: BuildingBankDelta };
}

function liquidateEstate(command: BankruptcyCommand, bankruptPlayer: Player, creditor: Player | null): EstateLiquidation {
  const empty: EstateLiquidation = { proceeds: 0, settlement: { propertyChanges: [], buildingBankDelta: { houses: 0, hotels: 0 } } };
  const spaces = command.spaces;
  const properties = command.properties;
  if (spaces === undefined && properties === undefined) {
    return empty;
  }

  // The two estate fields are one all-or-nothing group. Half of them is a caller
  // bug, and settling nothing on it would report a successful bankruptcy that
  // silently left every deed with the bankrupt player.
  if (spaces === undefined || properties === undefined) {
    throw new IncompleteEstateError(spaces === undefined ? ['spaces'] : ['properties']);
  }

  const owned = properties.filter((property) => property.ownerPlayerId === bankruptPlayer.id);
  return owned.reduce<EstateLiquidation>((estate, property) => {
    const space = findBoardSpace(spaces, property.boardSpaceId);
    const returned = buildingBankDeltaBetween(property.houses, 0);
    return {
      proceeds: estate.proceeds + buildingSaleProceeds(space, property.houses),
      settlement: {
        propertyChanges: [
          ...estate.settlement.propertyChanges,
          { boardSpaceId: property.boardSpaceId, ownerPlayerId: creditor === null ? null : creditor.id, houses: 0, mortgaged: property.mortgaged },
        ],
        buildingBankDelta: {
          houses: estate.settlement.buildingBankDelta.houses + returned.houses,
          hotels: estate.settlement.buildingBankDelta.hotels + returned.hotels,
        },
      },
    };
  }, empty);
}
