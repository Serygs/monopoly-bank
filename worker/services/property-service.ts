import type {
  CreatePaymentRequestResponse,
  CreateTransactionResponse,
  DiceRollRequest,
  DiceRollResponse,
  JailBailRequest,
  PaymentRequest,
  PropertyBuildRequest,
  PropertyMortgageRequest,
  PropertyOperationResponse,
  PropertyPurchaseRequest,
  PropertyRentRequest,
  PropertySellBuildingsRequest,
  PropertyStateResponse,
  PropertyUnmortgageRequest,
} from '../../shared/contracts/api.js';
import type { PropertyOperation } from '../../shared/contracts/live.js';
import { applyDiceRoll, payJailBail } from '../../shared/domain/jail.js';
import {
  buildHouses,
  calculateRent,
  mortgageProperty,
  payRent,
  purchaseProperty,
  sellBuildings,
  unmortgageProperty,
  type PropertyCommand,
  type PropertyOperationResult,
} from '../../shared/domain/property.js';
import { ensureActive, ensureDifferentPlayers, findPlayer, validateGame } from '../../shared/domain/banking-rules.js';
import type { Game, GameProperty, Player } from '../../shared/types/monopoly.js';
import type { BankingOperationRepository, PropertyStateWrite } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { PaymentRequestRepository } from '../repositories/payment-request-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { PropertyRepository } from '../repositories/property-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { BoardRequiredError, ConflictError, PersistenceConsistencyError, RentTargetUnownedError, ResourceNotFoundError, ValidationError } from './errors.js';

/** Everything a property operation reads before it calls the domain: the game, its wallets and the board slice. */
export interface PropertyWorld {
  game: Game;
  players: Player[];
  slice: PropertyStateResponse;
}

export interface PropertyWorldDependencies {
  games: GameRepository;
  players: PlayerRepository;
  properties: PropertyRepository;
}

/** Reads the game, its players and the board slice; a game without a board fails with `BOARD_REQUIRED`. */
export async function loadPropertyWorld(dependencies: PropertyWorldDependencies, gameId: string): Promise<PropertyWorld> {
  const game = await dependencies.games.getById(gameId);
  if (game === null) throw new ResourceNotFoundError('Game');
  if (game.boardId === null || game.boardId === undefined) throw new BoardRequiredError();
  const [players, slice] = await Promise.all([dependencies.players.listByGameId(gameId), dependencies.properties.loadPropertySlice(gameId)]);
  if (slice === null) throw new BoardRequiredError();
  return { game, players, slice };
}

/** The domain's view of the world: the wire slice keys the catalogue as `boardSpaces`, the domain as `spaces`. */
export function propertyCommandBase(world: PropertyWorld): PropertyCommand {
  return { game: world.game, players: world.players, board: world.slice.board, spaces: world.slice.boardSpaces, properties: world.slice.properties, buildingBank: world.slice.buildingBank };
}

/** Pairs each deed the domain rewrites with the row it was computed from, so the write is compare-and-set. */
export function propertyWrites(slice: PropertyStateResponse, result: PropertyOperationResult): PropertyStateWrite[] {
  return result.propertyChanges.map((change) => ({ previous: previousDeed(slice.properties, change.boardSpaceId), change }));
}

function previousDeed(properties: readonly GameProperty[], boardSpaceId: string): GameProperty {
  return properties.find((property) => property.boardSpaceId === boardSpaceId) ?? { boardSpaceId, ownerPlayerId: null, houses: 0, mortgaged: false };
}

/** The owner a rent claim is authorized against is whoever the stored deed names; a deed nobody holds cannot be charged for. */
export async function resolveRentOwner(properties: Pick<PropertyService, 'ownerOf'>, gameId: string, request: PropertyRentRequest): Promise<string> {
  const ownerPlayerId = await properties.ownerOf(gameId, request.boardSpaceId);
  if (ownerPlayerId === null) throw new RentTargetUnownedError(request.boardSpaceId);
  return ownerPlayerId;
}

/** Dispatches one `PROPERTY_OPERATION` to the service method it names; shared by the router's direct path and the coordinator. */
export function executePropertyOperation(properties: PropertyService, gameId: string, command: PropertyOperation): Promise<PropertyOperationResponse | CreatePaymentRequestResponse> {
  switch (command.operation) {
    case 'PURCHASE': return properties.purchase(gameId, command.request);
    case 'RENT': return properties.chargeRent(gameId, command.request);
    case 'BUILD': return properties.build(gameId, command.request);
    case 'SELL_BUILDINGS': return properties.sellBuildings(gameId, command.request);
    case 'MORTGAGE': return properties.mortgage(gameId, command.request);
    case 'UNMORTGAGE': return properties.unmortgage(gameId, command.request);
  }
}

export interface PropertyService {
  state(gameId: string): Promise<PropertyStateResponse>;
  /** The stored owner of a space, or `null`; the router uses it to build the authorized rent command. */
  ownerOf(gameId: string, boardSpaceId: string): Promise<string | null>;
  purchase(gameId: string, request: PropertyPurchaseRequest): Promise<PropertyOperationResponse>;
  chargeRent(gameId: string, request: PropertyRentRequest): Promise<PropertyOperationResponse | CreatePaymentRequestResponse>;
  build(gameId: string, request: PropertyBuildRequest): Promise<PropertyOperationResponse>;
  sellBuildings(gameId: string, request: PropertySellBuildingsRequest): Promise<PropertyOperationResponse>;
  mortgage(gameId: string, request: PropertyMortgageRequest): Promise<PropertyOperationResponse>;
  unmortgage(gameId: string, request: PropertyUnmortgageRequest): Promise<PropertyOperationResponse>;
  payJailBail(gameId: string, request: JailBailRequest): Promise<CreateTransactionResponse>;
  recordDiceRoll(gameId: string, request: DiceRollRequest): Promise<DiceRollResponse>;
}

export interface PropertyServiceDependencies extends PropertyWorldDependencies {
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  paymentRequests: PaymentRequestRepository;
  /** Returns the command id inside the coordinator, so a replayed command finds its own transaction. */
  createId: () => string;
  now?: () => Date;
}

const rentRequestTtlMs = 5 * 60 * 1000;

/**
 * A thin layer over the domain: read the slice, run the pure rule, hand the
 * result to `persist` as one batch, answer with the fresh state. Nothing here
 * decides a price or a rule; that is the domain's job.
 */
export class DefaultPropertyService implements PropertyService {
  private readonly dependencies: PropertyServiceDependencies;
  private readonly now: () => Date;

  constructor(dependencies: PropertyServiceDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
  }

  async state(gameId: string): Promise<PropertyStateResponse> {
    return (await loadPropertyWorld(this.dependencies, gameId)).slice;
  }

  async ownerOf(gameId: string, boardSpaceId: string): Promise<string | null> {
    const properties = await this.dependencies.properties.listProperties(gameId);
    return properties.find((property) => property.boardSpaceId === boardSpaceId)?.ownerPlayerId ?? null;
  }

  async purchase(gameId: string, request: PropertyPurchaseRequest): Promise<PropertyOperationResponse> {
    return this.commit(gameId, (world) => purchaseProperty({ ...propertyCommandBase(world),playerId: request.playerId, boardSpaceId: request.boardSpaceId, comment: request.comment }));
  }

  async chargeRent(gameId: string, request: PropertyRentRequest): Promise<PropertyOperationResponse | CreatePaymentRequestResponse> {
    const transactionId = this.dependencies.createId();
    const replay = await this.replay(gameId, transactionId);
    if (replay !== null) return replay;
    const world = await loadPropertyWorld(this.dependencies, gameId);
    if (world.game.paymentMode === 'CONFIRMATION' && request.chargedByOwner === true) return this.createRentRequest(world, request, transactionId);
    return this.persistOperation(world, transactionId, payRent(this.rentCommand(world, request)));
  }

  async build(gameId: string, request: PropertyBuildRequest): Promise<PropertyOperationResponse> {
    return this.commit(gameId, (world) => buildHouses({ ...propertyCommandBase(world),playerId: request.playerId, boardSpaceId: request.boardSpaceId, count: request.count, comment: request.comment }));
  }

  async sellBuildings(gameId: string, request: PropertySellBuildingsRequest): Promise<PropertyOperationResponse> {
    return this.commit(gameId, (world) => sellBuildings({ ...propertyCommandBase(world),playerId: request.playerId, boardSpaceId: request.boardSpaceId, count: request.count, comment: request.comment }));
  }

  async mortgage(gameId: string, request: PropertyMortgageRequest): Promise<PropertyOperationResponse> {
    return this.commit(gameId, (world) => mortgageProperty({ ...propertyCommandBase(world),playerId: request.playerId, boardSpaceId: request.boardSpaceId, comment: request.comment }));
  }

  async unmortgage(gameId: string, request: PropertyUnmortgageRequest): Promise<PropertyOperationResponse> {
    return this.commit(gameId, (world) => unmortgageProperty({ ...propertyCommandBase(world),playerId: request.playerId, boardSpaceId: request.boardSpaceId, comment: request.comment }));
  }

  async payJailBail(gameId: string, request: JailBailRequest): Promise<CreateTransactionResponse> {
    const transactionId = this.dependencies.createId();
    const existing = await this.dependencies.transactions.getById(gameId, transactionId);
    if (existing !== null) return { transaction: existing, players: await this.dependencies.players.listByGameId(gameId) };
    const world = await loadPropertyWorld(this.dependencies, gameId);
    const result = payJailBail({ game: world.game, players: world.players, board: world.slice.board, playerId: request.playerId, comment: request.comment });
    await this.dependencies.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      jailChange: result.jailChange,
      recentAmount: result.transaction.amount,
    });
    const transaction = await this.dependencies.transactions.getById(gameId, transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    return { transaction, players: await this.dependencies.players.listByGameId(gameId) };
  }

  /**
   * A roll is a receipt, not a banking operation: it writes the player's last
   * total and the doubles streak and never touches a balance or the ledger. It
   * still enters through the coordinator so the state version advances.
   */
  async recordDiceRoll(gameId: string, request: DiceRollRequest): Promise<DiceRollResponse> {
    const world = await loadPropertyWorld(this.dependencies, gameId);
    const players = validateGame(world.game, world.players);
    const player = findPlayer(players, request.playerId);
    ensureActive(player);
    const roll = { first: request.first, second: request.second, total: request.first + request.second, isDouble: request.first === request.second };
    const doubles = applyDiceRoll(player.consecutiveDoubles ?? 0, roll);
    const updated = await this.dependencies.players.updateGameplayState(player.id, {
      lastRollTotal: roll.total,
      lastRollAt: this.now().toISOString(),
      consecutiveDoubles: doubles.consecutiveDoubles,
      ...(doubles.thirdDouble ? { isInJail: true } : {}),
    });
    if (updated === null) throw new PersistenceConsistencyError();
    return { player: { ...updated, userId: player.userId }, thirdDouble: doubles.thirdDouble };
  }

  private async commit(gameId: string, operation: (world: PropertyWorld) => PropertyOperationResult): Promise<PropertyOperationResponse> {
    const transactionId = this.dependencies.createId();
    const replay = await this.replay(gameId, transactionId);
    if (replay !== null) return replay;
    const world = await loadPropertyWorld(this.dependencies, gameId);
    return this.persistOperation(world, transactionId, operation(world));
  }

  /** A command replayed after its commit finds its transaction already written and answers with the current state. */
  private async replay(gameId: string, transactionId: string): Promise<PropertyOperationResponse | null> {
    const existing = await this.dependencies.transactions.getById(gameId, transactionId);
    if (existing === null) return null;
    return this.respond(gameId, existing);
  }

  private async persistOperation(world: PropertyWorld, transactionId: string, result: PropertyOperationResult): Promise<PropertyOperationResponse> {
    await this.dependencies.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      propertyChanges: propertyWrites(world.slice, result),
      buildingBankDelta: result.buildingBankDelta,
      recentAmount: result.transaction.amount,
    });
    const transaction = await this.dependencies.transactions.getById(world.game.id, transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    return this.respond(world.game.id, transaction);
  }

  private async respond(gameId: string, transaction: PropertyOperationResponse['transaction']): Promise<PropertyOperationResponse> {
    const [players, slice] = await Promise.all([this.dependencies.players.listByGameId(gameId), this.dependencies.properties.loadPropertySlice(gameId)]);
    if (slice === null) throw new PersistenceConsistencyError();
    return { transaction, players, properties: slice.properties, buildingBank: slice.buildingBank };
  }

  /** Utility rent without an explicit total falls back to the payer's last recorded roll; the domain rejects a missing one. */
  private rentCommand(world: PropertyWorld, request: PropertyRentRequest) {
    const payer = world.players.find((player) => player.id === request.payerPlayerId);
    const diceTotal = request.diceTotal ?? payer?.lastRollTotal ?? undefined;
    return { ...propertyCommandBase(world),payerPlayerId: request.payerPlayerId, boardSpaceId: request.boardSpaceId, comment: request.comment, ...(diceTotal === undefined ? {} : { diceTotal }) };
  }

  /**
   * In confirmation mode an owner's claim becomes a request the payer approves.
   * The amount is what the deed earns right now; acceptance reprices it against
   * the deed as it is then, because the table may have built or mortgaged since.
   */
  private async createRentRequest(world: PropertyWorld, request: PropertyRentRequest, requestId: string): Promise<CreatePaymentRequestResponse> {
    const command = this.rentCommand(world, request);
    const players = validateGame(world.game, world.players);
    const amount = calculateRent(command);
    const ownerPlayerId = world.slice.properties.find((property) => property.boardSpaceId === request.boardSpaceId)?.ownerPlayerId;
    if (ownerPlayerId === undefined || ownerPlayerId === null) throw new ValidationError('This property has no owner to collect rent.');
    const owner = findPlayer(players, ownerPlayerId);
    const payer = findPlayer(players, request.payerPlayerId);
    ensureDifferentPlayers(payer, owner);
    ensureActive(payer);
    ensureActive(owner);
    const reserved = await this.dependencies.paymentRequests.pendingReservedAmount(world.game.id, payer.id);
    if (payer.balance - reserved < amount) throw new ConflictError('INSUFFICIENT_AVAILABLE_FUNDS', 'Player does not have enough available funds.');

    const paymentRequest: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'> = {
      id: requestId,
      gameId: world.game.id,
      payerPlayerId: payer.id,
      recipientPlayerId: owner.id,
      creatorPlayerId: owner.id,
      approverPlayerId: payer.id,
      amount,
      comment: request.comment ?? null,
      state: 'PENDING',
      expiresAt: new Date(this.now().getTime() + rentRequestTtlMs).toISOString(),
      boardSpaceId: request.boardSpaceId,
    };
    await this.dependencies.paymentRequests.create(paymentRequest);
    const stored = await this.dependencies.paymentRequests.getById(world.game.id, requestId);
    if (stored === null) throw new PersistenceConsistencyError();
    return { paymentRequests: [stored], players: world.players };
  }
}
