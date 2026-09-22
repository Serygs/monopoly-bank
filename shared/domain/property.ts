import type {
  BoardDefinition,
  BoardSpace,
  BuildingBank,
  Game,
  GameProperty,
  Player,
  TransactionType,
} from '../types/monopoly.js';
import { hotelHouseLevel } from '../types/monopoly.js';
import {
  BankingDomainError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  PlayerBankruptError,
  PlayerNotFoundError,
  SameSourceAndDestinationError,
  type BankingOperationResult,
  type PlayerBalanceChange,
} from './banking.js';

/**
 * Every property operation takes the same slice of the world: the game, its
 * wallets, the board dictionary, the current ownership rows and the building
 * bank. Nothing here reads a database or mutates its input.
 */
export interface PropertyCommand {
  game: Game;
  players: readonly Player[];
  board: BoardDefinition;
  spaces: readonly BoardSpace[];
  properties: readonly GameProperty[];
  buildingBank: BuildingBank;
  comment?: string | null;
}

export interface PurchasePropertyCommand extends PropertyCommand {
  playerId: string;
  boardSpaceId: string;
}

export interface CalculateRentCommand extends PropertyCommand {
  boardSpaceId: string;
  diceTotal?: number;
}

export interface PayRentCommand extends PropertyCommand {
  payerPlayerId: string;
  boardSpaceId: string;
  diceTotal?: number;
}

export interface BuildHousesCommand extends PropertyCommand {
  playerId: string;
  boardSpaceId: string;
  count: number;
}

export interface SellBuildingsCommand extends PropertyCommand {
  playerId: string;
  boardSpaceId: string;
  count: number;
}

export interface MortgagePropertyCommand extends PropertyCommand {
  playerId: string;
  boardSpaceId: string;
}

export interface UnmortgagePropertyCommand extends PropertyCommand {
  playerId: string;
  boardSpaceId: string;
}

/** The ownership row a persisted operation must write, already in its final shape. */
export interface PropertyChange {
  boardSpaceId: string;
  ownerPlayerId: string | null;
  houses: number;
  mortgaged: boolean;
}

/** Signed change to the game's building bank: positive returns buildings, negative takes them. */
export interface BuildingBankDelta {
  houses: number;
  hotels: number;
}

export interface PropertyOperationResult extends BankingOperationResult {
  propertyChanges: PropertyChange[];
  buildingBankDelta: BuildingBankDelta;
}

export type PropertyErrorCode =
  | 'PROPERTY_NOT_FOUND'
  | 'PROPERTY_ALREADY_OWNED'
  | 'PROPERTY_NOT_OWNED'
  | 'PROPERTY_MORTGAGED'
  | 'PROPERTY_NOT_MORTGAGED'
  | 'INCOMPLETE_COLOR_GROUP'
  | 'UNEVEN_BUILDING'
  | 'BUILDING_BANK_EMPTY'
  | 'BUILDINGS_PRESENT'
  | 'BUILDINGS_NOT_ALLOWED'
  | 'DICE_TOTAL_REQUIRED'
  | 'INVALID_DICE_TOTAL';

export class PropertyNotFoundError extends BankingDomainError {
  readonly code = 'PROPERTY_NOT_FOUND' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'PROPERTY_NOT_FOUND', message: 'Board space not found.', status: 404, details: { boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class PropertyAlreadyOwnedError extends BankingDomainError {
  readonly code = 'PROPERTY_ALREADY_OWNED' as const;
  readonly boardSpaceId: string;
  readonly ownerPlayerId: string;

  constructor(boardSpaceId: string, ownerPlayerId: string) {
    super({ code: 'PROPERTY_ALREADY_OWNED', message: 'This property already has an owner.', status: 409, details: { boardSpaceId, ownerPlayerId } });
    this.boardSpaceId = boardSpaceId;
    this.ownerPlayerId = ownerPlayerId;
  }
}

export class PropertyNotOwnedError extends BankingDomainError {
  readonly code = 'PROPERTY_NOT_OWNED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'PROPERTY_NOT_OWNED', message: 'This property is not owned by that player.', status: 409, details: { boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class PropertyMortgagedError extends BankingDomainError {
  readonly code = 'PROPERTY_MORTGAGED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'PROPERTY_MORTGAGED', message: 'This property is mortgaged.', status: 409, details: { boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class PropertyNotMortgagedError extends BankingDomainError {
  readonly code = 'PROPERTY_NOT_MORTGAGED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'PROPERTY_NOT_MORTGAGED', message: 'This property is not mortgaged.', status: 409, details: { boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class IncompleteColorGroupError extends BankingDomainError {
  readonly code = 'INCOMPLETE_COLOR_GROUP' as const;
  readonly colorGroup: string;

  constructor(colorGroup: string) {
    super({ code: 'INCOMPLETE_COLOR_GROUP', message: 'Building requires the whole colour group.', status: 409, details: { colorGroup } });
    this.colorGroup = colorGroup;
  }
}

export class UnevenBuildingError extends BankingDomainError {
  readonly code = 'UNEVEN_BUILDING' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'UNEVEN_BUILDING', message: 'Buildings must be spread evenly across the colour group.', status: 409, details: { boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class BuildingBankEmptyError extends BankingDomainError {
  readonly code = 'BUILDING_BANK_EMPTY' as const;
  readonly requiredHouses: number;
  readonly requiredHotels: number;

  constructor(requiredHouses: number, requiredHotels: number, bank: BuildingBank) {
    super({ code: 'BUILDING_BANK_EMPTY', message: 'The building bank does not hold enough buildings.', status: 409, details: { requiredHouses, requiredHotels, housesAvailable: bank.housesAvailable, hotelsAvailable: bank.hotelsAvailable } });
    this.requiredHouses = requiredHouses;
    this.requiredHotels = requiredHotels;
  }
}

export class BuildingsPresentError extends BankingDomainError {
  readonly code = 'BUILDINGS_PRESENT' as const;
  readonly colorGroup: string;

  constructor(colorGroup: string) {
    super({ code: 'BUILDINGS_PRESENT', message: 'Sell the buildings on this colour group first.', status: 409, details: { colorGroup } });
    this.colorGroup = colorGroup;
  }
}

/** Raised when a space can never hold buildings, or when the requested level is outside 0..5. */
export class BuildingsNotAllowedError extends BankingDomainError {
  readonly code = 'BUILDINGS_NOT_ALLOWED' as const;
  readonly boardSpaceId: string;
  readonly reason: string;

  constructor(boardSpaceId: string, reason: string) {
    super({ code: 'BUILDINGS_NOT_ALLOWED', message: 'Buildings cannot be placed on this property.', status: 409, details: { boardSpaceId, reason } });
    this.boardSpaceId = boardSpaceId;
    this.reason = reason;
  }
}

export class DiceTotalRequiredError extends BankingDomainError {
  readonly code = 'DICE_TOTAL_REQUIRED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'DICE_TOTAL_REQUIRED', message: 'Utility rent needs the dice total.', status: 400, details: { field: 'diceTotal', boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class InvalidDiceTotalError extends BankingDomainError {
  readonly code = 'INVALID_DICE_TOTAL' as const;
  readonly diceTotal: number;

  constructor(diceTotal: number) {
    super({ code: 'INVALID_DICE_TOTAL', message: 'The dice total must be between 2 and 12.', status: 400, details: { field: 'diceTotal', diceTotal } });
    this.diceTotal = diceTotal;
  }
}

export function purchaseProperty(command: PurchasePropertyCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  const space = findSpace(command.spaces, command.boardSpaceId);
  const property = findProperty(command.properties, command.boardSpaceId);
  if (property.ownerPlayerId !== null) {
    throw new PropertyAlreadyOwnedError(space.id, property.ownerPlayerId);
  }

  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  validateAmount(space.price);
  ensureSufficientFunds(player, space.price);

  return {
    ...createResult(command.game.id, 'PROPERTY_PURCHASE', space.price, space.price, command.comment, [
      createBalanceChange(player, -space.price),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: player.id, houses: 0, mortgaged: false }],
    buildingBankDelta: noBuildingChange(),
  };
}

/**
 * The canonical rent of a space, given who owns what right now. Exported on its
 * own so a pending rent request can be repriced at the moment it is accepted.
 */
export function calculateRent(command: CalculateRentCommand): number {
  const space = findSpace(command.spaces, command.boardSpaceId);
  const property = findProperty(command.properties, command.boardSpaceId);
  const ownerPlayerId = property.ownerPlayerId;
  if (ownerPlayerId === null) {
    throw new PropertyNotOwnedError(space.id);
  }
  if (property.mortgaged) {
    throw new PropertyMortgagedError(space.id);
  }

  const rent = space.kind === 'STREET'
    ? streetRent(command, space, property, ownerPlayerId)
    : space.kind === 'RAILROAD'
      ? railroadRent(command, space, ownerPlayerId)
      : utilityRent(command, space, ownerPlayerId);
  validateAmount(rent);
  return rent;
}

export function payRent(command: PayRentCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  const space = findSpace(command.spaces, command.boardSpaceId);
  const rent = calculateRent(command);

  const owner = findPlayer(players, ownerOf(command.properties, space.id));
  const payer = findPlayer(players, command.payerPlayerId);
  ensureDifferentPlayers(payer, owner);
  ensureActive(payer);
  ensureActive(owner);
  ensureSufficientFunds(payer, rent);

  return {
    ...createResult(command.game.id, 'PROPERTY_RENT', rent, rent, command.comment, [
      createBalanceChange(payer, -rent),
      createBalanceChange(owner, rent),
    ]),
    propertyChanges: [],
    buildingBankDelta: noBuildingChange(),
  };
}

export function buildHouses(command: BuildHousesCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.count);

  const space = findSpace(command.spaces, command.boardSpaceId);
  const houseCost = buildableHouseCost(space);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);

  const group = colorGroupSpaces(command.spaces, space);
  ensureWholeGroupOwnedBy(command, group, player.id);
  ensureGroupUnmortgaged(command, group);

  const property = findProperty(command.properties, space.id);
  const targetHouses = property.houses + command.count;
  if (targetHouses > hotelHouseLevel) {
    throw new BuildingsNotAllowedError(space.id, 'a space cannot hold more than a hotel');
  }
  ensureEvenBuilding(command, group, space.id, targetHouses);

  const drawnHouses = Math.min(targetHouses, hotelHouseLevel - 1) - Math.min(property.houses, hotelHouseLevel - 1);
  const drawnHotels = targetHouses === hotelHouseLevel ? 1 : 0;
  ensureBuildingsAvailable(command.buildingBank, drawnHouses, drawnHotels);

  const totalCost = multiplyAmounts(houseCost, command.count);
  ensureSufficientFunds(player, totalCost);

  return {
    ...createResult(command.game.id, 'PROPERTY_BUILD', houseCost, totalCost, command.comment, [
      createBalanceChange(player, -totalCost),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: player.id, houses: targetHouses, mortgaged: false }],
    buildingBankDelta: buildingBankDelta(property.houses, targetHouses),
  };
}

export function sellBuildings(command: SellBuildingsCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  validateAmount(command.count);

  const space = findSpace(command.spaces, command.boardSpaceId);
  const houseCost = buildableHouseCost(space);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureOwnedBy(command.properties, space.id, player.id);

  const property = findProperty(command.properties, space.id);
  const targetHouses = property.houses - command.count;
  if (targetHouses < 0) {
    throw new BuildingsNotAllowedError(space.id, 'this space does not hold that many buildings');
  }
  const group = colorGroupSpaces(command.spaces, space);
  ensureEvenBuilding(command, group, space.id, targetHouses);

  // Breaking a hotel means taking four houses out of the bank before selling any back.
  ensureBuildingsAvailable(command.buildingBank, property.houses === hotelHouseLevel ? hotelHouseLevel - 1 : 0, 0);

  const pricePerBuilding = Math.floor(houseCost / 2);
  const totalProceeds = multiplyAmounts(pricePerBuilding, command.count);
  validateAmount(totalProceeds);

  return {
    ...createResult(command.game.id, 'PROPERTY_SELL_BUILDINGS', pricePerBuilding, totalProceeds, command.comment, [
      createBalanceChange(player, totalProceeds),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: player.id, houses: targetHouses, mortgaged: false }],
    buildingBankDelta: buildingBankDelta(property.houses, targetHouses),
  };
}

export function mortgageProperty(command: MortgagePropertyCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  const space = findSpace(command.spaces, command.boardSpaceId);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureOwnedBy(command.properties, space.id, player.id);

  const property = findProperty(command.properties, space.id);
  if (property.mortgaged) {
    throw new PropertyMortgagedError(space.id);
  }
  for (const groupSpace of colorGroupSpaces(command.spaces, space)) {
    if (findProperty(command.properties, groupSpace.id).houses > 0) {
      throw new BuildingsPresentError(space.colorGroup);
    }
  }

  validateAmount(space.mortgageValue);
  return {
    ...createResult(command.game.id, 'PROPERTY_MORTGAGE', space.mortgageValue, space.mortgageValue, command.comment, [
      createBalanceChange(player, space.mortgageValue),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: player.id, houses: 0, mortgaged: true }],
    buildingBankDelta: noBuildingChange(),
  };
}

export function unmortgageProperty(command: UnmortgagePropertyCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  const space = findSpace(command.spaces, command.boardSpaceId);
  const player = findPlayer(players, command.playerId);
  ensureActive(player);
  ensureOwnedBy(command.properties, space.id, player.id);

  if (!findProperty(command.properties, space.id).mortgaged) {
    throw new PropertyNotMortgagedError(space.id);
  }

  const cost = unmortgageCost(space.mortgageValue, command.board.unmortgageInterestPercent);
  ensureSufficientFunds(player, cost);

  return {
    ...createResult(command.game.id, 'PROPERTY_UNMORTGAGE', cost, cost, command.comment, [
      createBalanceChange(player, -cost),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: player.id, houses: 0, mortgaged: false }],
    buildingBankDelta: noBuildingChange(),
  };
}

/** The mortgage value plus the board's interest, always rounded up in the bank's favour. */
export function unmortgageCost(mortgageValue: number, unmortgageInterestPercent: number): number {
  const cost = mortgageValue + Math.ceil((mortgageValue * unmortgageInterestPercent) / 100);
  validateAmount(cost);
  return cost;
}

function noBuildingChange(): BuildingBankDelta {
  return { houses: 0, hotels: 0 };
}

function streetRent(command: CalculateRentCommand, space: BoardSpace, property: GameProperty, ownerPlayerId: string): number {
  if (property.houses > 0) {
    return rentLevel(space, property.houses);
  }

  const group = colorGroupSpaces(command.spaces, space);
  // A mortgaged space still counts towards holding the group, but any building
  // anywhere in the group replaces the undeveloped double with per-level rent.
  const ownsWholeGroup = group.every((groupSpace) => findProperty(command.properties, groupSpace.id).ownerPlayerId === ownerPlayerId);
  const groupIsUndeveloped = group.every((groupSpace) => findProperty(command.properties, groupSpace.id).houses === 0);
  const baseRent = rentLevel(space, 0);
  return ownsWholeGroup && groupIsUndeveloped ? baseRent * 2 : baseRent;
}

function railroadRent(command: CalculateRentCommand, space: BoardSpace, ownerPlayerId: string): number {
  const owned = colorGroupSpaces(command.spaces, space).filter((groupSpace) => {
    const property = findProperty(command.properties, groupSpace.id);
    return property.ownerPlayerId === ownerPlayerId && !property.mortgaged;
  }).length;
  return rentLevel(space, owned - 1);
}

function utilityRent(command: CalculateRentCommand, space: BoardSpace, ownerPlayerId: string): number {
  const diceTotal = command.diceTotal;
  if (diceTotal === undefined || diceTotal === null) {
    throw new DiceTotalRequiredError(space.id);
  }
  if (!Number.isSafeInteger(diceTotal) || diceTotal < 2 || diceTotal > 12) {
    throw new InvalidDiceTotalError(diceTotal);
  }

  const owned = colorGroupSpaces(command.spaces, space).filter(
    (groupSpace) => findProperty(command.properties, groupSpace.id).ownerPlayerId === ownerPlayerId,
  ).length;
  const multiplier = owned > 1 ? command.board.utilityMultiplierPair : command.board.utilityMultiplierSingle;
  return multiplyAmounts(diceTotal, multiplier);
}

function rentLevel(space: BoardSpace, level: number): number {
  const rent = space.rents[level];
  if (rent === undefined) {
    throw new InvalidGameStateError(`board space "${space.id}" has no rent for level ${level}`);
  }
  return rent;
}

function buildableHouseCost(space: BoardSpace): number {
  if (space.kind !== 'STREET' || space.houseCost === null) {
    throw new BuildingsNotAllowedError(space.id, 'only streets can be built on');
  }
  validateAmount(space.houseCost);
  return space.houseCost;
}

function colorGroupSpaces(spaces: readonly BoardSpace[], space: BoardSpace): readonly BoardSpace[] {
  return spaces.filter((candidate) => candidate.colorGroup === space.colorGroup);
}

function ensureWholeGroupOwnedBy(command: PropertyCommand, group: readonly BoardSpace[], playerId: string): void {
  for (const groupSpace of group) {
    if (findProperty(command.properties, groupSpace.id).ownerPlayerId !== playerId) {
      throw new IncompleteColorGroupError(groupSpace.colorGroup);
    }
  }
}

function ensureGroupUnmortgaged(command: PropertyCommand, group: readonly BoardSpace[]): void {
  for (const groupSpace of group) {
    if (findProperty(command.properties, groupSpace.id).mortgaged) {
      throw new PropertyMortgagedError(groupSpace.id);
    }
  }
}

function ensureEvenBuilding(command: PropertyCommand, group: readonly BoardSpace[], boardSpaceId: string, targetHouses: number): void {
  const levels = group.map((groupSpace) =>
    groupSpace.id === boardSpaceId ? targetHouses : findProperty(command.properties, groupSpace.id).houses,
  );
  if (Math.max(...levels) - Math.min(...levels) > 1) {
    throw new UnevenBuildingError(boardSpaceId);
  }
}

function ensureBuildingsAvailable(bank: BuildingBank, requiredHouses: number, requiredHotels: number): void {
  if (bank.housesAvailable < requiredHouses || bank.hotelsAvailable < requiredHotels) {
    throw new BuildingBankEmptyError(requiredHouses, requiredHotels, bank);
  }
}

/** Positive numbers return buildings to the bank; negative numbers take them out of it. */
function buildingBankDelta(fromHouses: number, toHouses: number): BuildingBankDelta {
  const standingHouses = (houses: number): number => (houses === hotelHouseLevel ? 0 : houses);
  const standingHotels = (houses: number): number => (houses === hotelHouseLevel ? 1 : 0);
  return {
    houses: standingHouses(fromHouses) - standingHouses(toHouses),
    hotels: standingHotels(fromHouses) - standingHotels(toHouses),
  };
}

function ensureOwnedBy(properties: readonly GameProperty[], boardSpaceId: string, playerId: string): void {
  if (findProperty(properties, boardSpaceId).ownerPlayerId !== playerId) {
    throw new PropertyNotOwnedError(boardSpaceId);
  }
}

function ownerOf(properties: readonly GameProperty[], boardSpaceId: string): string {
  const ownerPlayerId = findProperty(properties, boardSpaceId).ownerPlayerId;
  if (ownerPlayerId === null) {
    throw new PropertyNotOwnedError(boardSpaceId);
  }
  return ownerPlayerId;
}

function findSpace(spaces: readonly BoardSpace[], boardSpaceId: string): BoardSpace {
  const space = spaces.find((candidate) => candidate.id === boardSpaceId);
  if (space === undefined) {
    throw new PropertyNotFoundError(boardSpaceId);
  }
  return space;
}

/** A space with no ownership row has simply never been bought. */
function findProperty(properties: readonly GameProperty[], boardSpaceId: string): GameProperty {
  return (
    properties.find((candidate) => candidate.boardSpaceId === boardSpaceId)
    ?? { boardSpaceId, ownerPlayerId: null, houses: 0, mortgaged: false }
  );
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

function ensureActive(player: Player): void {
  if (player.status === 'BANKRUPT') {
    throw new PlayerBankruptError(player.id);
  }
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

function multiplyAmounts(amount: number, multiplier: number): number {
  const totalAmount = amount * multiplier;
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    throw new InvalidAmountError(totalAmount);
  }
  return totalAmount;
}

function createBalanceChange(player: Player, balanceDelta: number): PlayerBalanceChange {
  const balanceAfter = player.balance + balanceDelta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new InvalidGameStateError(`operation would produce an invalid balance for player "${player.id}"`);
  }
  return { player, balanceBefore: player.balance, balanceAfter, balanceDelta };
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
      participants: affectedPlayers.map(({ player, balanceDelta }) => ({ playerId: player.id, balanceDelta })),
    },
    affectedPlayers,
  };
}
