import type { BoardSpace, Player } from '../types/monopoly.js';
import {
  BankingDomainError,
  createBalanceChange,
  createResult,
  ensureActive,
  ensureDifferentPlayers,
  ensureSufficientFunds,
  findPlayer,
  InvalidAmountError,
  validateAmount,
  validateGame,
} from './banking-rules.js';
import {
  buildingBankDeltaBetween,
  buildingSaleProceeds,
  findBoardSpace,
  findGameProperty,
  PropertyAlreadyOwnedError,
  unmortgageCost,
  type BuildingBankDelta,
  type PropertyChange,
  type PropertyCommand,
  type PropertyOperationResult,
} from './property.js';

/**
 * Two operations that move deeds between two players in a single stroke: the
 * negotiated trade, and the bank auction that follows a declined purchase.
 *
 * A trade is deliberately split in two. `proposeTrade` only checks that the
 * offer is well formed and records the deed state it was made against — that
 * proposal is what `property_trades` stores. `applyTrade` is the commit, and it
 * re-reads the world: a deed that was mortgaged, built on or sold since the
 * offer was made invalidates the whole trade rather than half of it.
 */

/** What the receiving side chose for a mortgaged deed. Mirrors `property_trade_items.mortgage_resolution`. */
export type MortgageResolution = 'PAY_INTEREST' | 'REDEEM';

export interface TradePropertyOffer {
  boardSpaceId: string;
  /** Required for a mortgaged deed, ignored for any other. */
  mortgageResolution?: MortgageResolution | null;
}

export interface ProposeTradeCommand extends PropertyCommand {
  proposerPlayerId: string;
  responderPlayerId: string;
  cashFromProposer?: number;
  cashFromResponder?: number;
  propertiesFromProposer?: readonly TradePropertyOffer[];
  propertiesFromResponder?: readonly TradePropertyOffer[];
}

/** A deed's ownership, development and mortgage state at one moment. */
export interface TradeDeedState {
  ownerPlayerId: string | null;
  houses: number;
  mortgaged: boolean;
}

export interface TradeProposalItem {
  boardSpaceId: string;
  fromPlayerId: string;
  mortgageResolution: MortgageResolution | null;
  /** The state the offer was made against. `applyTrade` refuses the trade if it has moved. */
  recordedState: TradeDeedState;
}

export interface TradeProposal {
  gameId: string;
  proposerPlayerId: string;
  responderPlayerId: string;
  cashFromProposer: number;
  cashFromResponder: number;
  items: TradeProposalItem[];
}

export interface ApplyTradeCommand extends PropertyCommand {
  proposal: TradeProposal;
}

/** The price is whatever the table bid, so it is not checked against the catalogue price. */
export interface RecordAuctionResultCommand extends PropertyCommand {
  winnerPlayerId: string;
  boardSpaceId: string;
  price: number;
}

export type TradeErrorCode =
  | 'TRADE_PARTY_MISMATCH'
  | 'TRADE_EMPTY'
  | 'TRADE_PROPERTY_NOT_OWNED'
  | 'TRADE_STATE_CHANGED'
  | 'MORTGAGE_RESOLUTION_REQUIRED';

/** The proposal's composition does not line up with its two parties. */
export class TradePartyMismatchError extends BankingDomainError {
  readonly code = 'TRADE_PARTY_MISMATCH' as const;
  readonly reason: string;

  constructor(reason: string) {
    super({ code: 'TRADE_PARTY_MISMATCH', message: 'This trade does not match its parties.', status: 400, details: { reason } });
    this.reason = reason;
  }
}

export class TradeEmptyError extends BankingDomainError {
  readonly code = 'TRADE_EMPTY' as const;

  constructor() {
    super({ code: 'TRADE_EMPTY', message: 'A trade must move money or a deed.', status: 400 });
  }
}

export class TradePropertyNotOwnedError extends BankingDomainError {
  readonly code = 'TRADE_PROPERTY_NOT_OWNED' as const;
  readonly boardSpaceId: string;
  readonly fromPlayerId: string;

  constructor(boardSpaceId: string, fromPlayerId: string, ownerPlayerId: string | null) {
    super({ code: 'TRADE_PROPERTY_NOT_OWNED', message: 'That player does not own this deed.', status: 409, details: { boardSpaceId, fromPlayerId, ownerPlayerId } });
    this.boardSpaceId = boardSpaceId;
    this.fromPlayerId = fromPlayerId;
  }
}

export class TradeStateChangedError extends BankingDomainError {
  readonly code = 'TRADE_STATE_CHANGED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string, recorded: TradeDeedState, current: TradeDeedState) {
    super({ code: 'TRADE_STATE_CHANGED', message: 'A deed in this trade changed after the offer was made.', status: 409, details: { boardSpaceId, recorded, current } });
    this.boardSpaceId = boardSpaceId;
  }
}

export class MortgageResolutionRequiredError extends BankingDomainError {
  readonly code = 'MORTGAGE_RESOLUTION_REQUIRED' as const;
  readonly boardSpaceId: string;

  constructor(boardSpaceId: string) {
    super({ code: 'MORTGAGE_RESOLUTION_REQUIRED', message: 'A mortgaged deed needs a mortgage resolution.', status: 400, details: { field: 'mortgageResolution', boardSpaceId } });
    this.boardSpaceId = boardSpaceId;
  }
}

/**
 * Validates an offer and freezes the deed state it was made against. No money
 * moves and no balance is checked here: a proposal the responder never accepts
 * must never have been able to fail on the proposer's wallet.
 */
export function proposeTrade(command: ProposeTradeCommand): TradeProposal {
  const players = validateGame(command.game, command.players);
  const proposer = findPlayer(players, command.proposerPlayerId);
  const responder = findPlayer(players, command.responderPlayerId);
  ensureDifferentPlayers(proposer, responder);
  ensureActive(proposer);
  ensureActive(responder);

  const cashFromProposer = validateCash(command.cashFromProposer ?? 0);
  const cashFromResponder = validateCash(command.cashFromResponder ?? 0);
  const items = [
    ...(command.propertiesFromProposer ?? []).map((offer) => recordItem(command, offer, proposer.id)),
    ...(command.propertiesFromResponder ?? []).map((offer) => recordItem(command, offer, responder.id)),
  ];
  ensureNoRepeatedDeed(items);
  if (cashFromProposer === 0 && cashFromResponder === 0 && items.length === 0) {
    throw new TradeEmptyError();
  }

  return {
    gameId: command.game.id,
    proposerPlayerId: proposer.id,
    responderPlayerId: responder.id,
    cashFromProposer,
    cashFromResponder,
    items,
  };
}

/**
 * Commits a proposal. Every deed in the trade is sold clear of its buildings —
 * the bank pays the giver half the house cost per building — and a mortgaged
 * deed is settled by the receiver, who either pays the interest and keeps it
 * mortgaged or redeems it outright. Only once all of that is accounted for is
 * either wallet asked whether it can afford the trade, so a player who can only
 * pay because of what the trade hands them still passes.
 */
export function applyTrade(command: ApplyTradeCommand): PropertyOperationResult {
  const proposal = command.proposal;
  const players = validateGame(command.game, command.players);
  if (proposal.gameId !== command.game.id) {
    throw new TradePartyMismatchError('the proposal belongs to another game');
  }

  const proposer = findPlayer(players, proposal.proposerPlayerId);
  const responder = findPlayer(players, proposal.responderPlayerId);
  ensureDifferentPlayers(proposer, responder);
  ensureActive(proposer);
  ensureActive(responder);
  const cashFromProposer = validateCash(proposal.cashFromProposer);
  const cashFromResponder = validateCash(proposal.cashFromResponder);

  // All of the drift is checked before any of the trade is built, so a stale
  // proposal never produces a half-applied result.
  ensureNoRepeatedDeed(proposal.items);
  for (const item of proposal.items) {
    ensureDeedUnchanged(command, item, proposer, responder);
  }

  const settlements = proposal.items.map((item) => settleItem(command, item, proposer, responder));
  const cashGiven = (player: Player): number => (player.id === proposer.id ? cashFromProposer : cashFromResponder);
  const cashReceived = (player: Player): number => (player.id === proposer.id ? cashFromResponder : cashFromProposer);
  const netDelta = (player: Player): number =>
    cashReceived(player)
    - cashGiven(player)
    + totalBy(settlements.filter((settlement) => settlement.giverPlayerId === player.id), (settlement) => settlement.buildingProceeds)
    - totalBy(settlements.filter((settlement) => settlement.receiverPlayerId === player.id), (settlement) => settlement.mortgagePayment);

  const parties = [proposer, responder].map((player) => ({ player, delta: netDelta(player) }));
  for (const { player, delta } of parties) {
    if (delta < 0) {
      ensureSufficientFunds(player, -delta);
    }
  }

  // Only the cash that actually crosses counts: two equal offers cancel each
  // other out and move nothing, so the ledger must not claim both sides' gross.
  // The ledger stores no zero-delta participant and no zero-amount transaction,
  // so a trade in which nothing moves — a pure deed-for-deed swap, or cash that
  // cancels — is recorded at the same nominal 1 a cashless bankruptcy uses.
  const moved = Math.abs(cashFromProposer - cashFromResponder)
    + totalBy(settlements, (settlement) => settlement.buildingProceeds)
    + totalBy(settlements, (settlement) => settlement.mortgagePayment);
  const amount = Math.max(1, moved);
  validateAmount(amount);

  return {
    ...createResult(
      command.game.id,
      'PROPERTY_TRADE',
      amount,
      amount,
      command.comment,
      parties
        .filter(({ delta }) => delta !== 0)
        .map(({ player, delta }) => createBalanceChange(player, delta)),
    ),
    propertyChanges: settlements.map((settlement) => settlement.change),
    buildingBankDelta: settlements.reduce<BuildingBankDelta>(
      (total, settlement) => ({ houses: total.houses + settlement.bankDelta.houses, hotels: total.hotels + settlement.bankDelta.hotels }),
      { houses: 0, hotels: 0 },
    ),
  };
}

/**
 * The bank's auction of a deed nobody bought at the catalogue price. The winning
 * bid is whatever the table agreed, so it is only required to be a positive
 * amount the winner can cover.
 */
export function recordAuctionResult(command: RecordAuctionResultCommand): PropertyOperationResult {
  const players = validateGame(command.game, command.players);
  const space = findBoardSpace(command.spaces, command.boardSpaceId);
  const property = findGameProperty(command.properties, space.id);
  if (property.ownerPlayerId !== null) {
    throw new PropertyAlreadyOwnedError(space.id, property.ownerPlayerId);
  }

  const winner = findPlayer(players, command.winnerPlayerId);
  ensureActive(winner);
  validateAmount(command.price);
  ensureSufficientFunds(winner, command.price);

  return {
    ...createResult(command.game.id, 'PROPERTY_AUCTION', command.price, command.price, command.comment, [
      createBalanceChange(winner, -command.price),
    ]),
    propertyChanges: [{ boardSpaceId: space.id, ownerPlayerId: winner.id, houses: 0, mortgaged: false }],
    buildingBankDelta: { houses: 0, hotels: 0 },
  };
}

interface ItemSettlement {
  change: PropertyChange;
  giverPlayerId: string;
  receiverPlayerId: string;
  /** Half the house cost per building, paid by the bank to the giver. */
  buildingProceeds: number;
  /** Interest or full redemption, paid by the receiver to the bank. */
  mortgagePayment: number;
  bankDelta: BuildingBankDelta;
}

function settleItem(command: ApplyTradeCommand, item: TradeProposalItem, proposer: Player, responder: Player): ItemSettlement {
  const giver = partyOf(item.fromPlayerId, proposer, responder);
  const receiver = giver.id === proposer.id ? responder : proposer;
  const space = findBoardSpace(command.spaces, item.boardSpaceId);
  const state = item.recordedState;
  const resolution = state.mortgaged ? requireResolution(space.id, item.mortgageResolution) : null;

  return {
    change: { boardSpaceId: space.id, ownerPlayerId: receiver.id, houses: 0, mortgaged: resolution === 'PAY_INTEREST' },
    giverPlayerId: giver.id,
    receiverPlayerId: receiver.id,
    buildingProceeds: buildingSaleProceeds(space, state.houses),
    mortgagePayment: mortgageSettlement(command, space, resolution),
    bankDelta: buildingBankDeltaBetween(state.houses, 0),
  };
}

/** Redeeming costs the mortgage plus the board's interest; keeping it mortgaged costs the interest alone. */
function mortgageSettlement(command: ApplyTradeCommand, space: BoardSpace, resolution: MortgageResolution | null): number {
  if (resolution === null) {
    return 0;
  }
  const redemption = unmortgageCost(space.mortgageValue, command.board.unmortgageInterestPercent);
  return resolution === 'REDEEM' ? redemption : redemption - space.mortgageValue;
}

function recordItem(command: ProposeTradeCommand, offer: TradePropertyOffer, fromPlayerId: string): TradeProposalItem {
  const space = findBoardSpace(command.spaces, offer.boardSpaceId);
  const property = findGameProperty(command.properties, space.id);
  if (property.ownerPlayerId !== fromPlayerId) {
    throw new TradePropertyNotOwnedError(space.id, fromPlayerId, property.ownerPlayerId);
  }

  return {
    boardSpaceId: space.id,
    fromPlayerId,
    mortgageResolution: property.mortgaged ? requireResolution(space.id, offer.mortgageResolution) : null,
    recordedState: { ownerPlayerId: property.ownerPlayerId, houses: property.houses, mortgaged: property.mortgaged },
  };
}

function ensureDeedUnchanged(command: ApplyTradeCommand, item: TradeProposalItem, proposer: Player, responder: Player): void {
  const giver = partyOf(item.fromPlayerId, proposer, responder);
  const recorded = item.recordedState;
  if (recorded.ownerPlayerId !== giver.id) {
    throw new TradePropertyNotOwnedError(item.boardSpaceId, giver.id, recorded.ownerPlayerId);
  }

  const property = findGameProperty(command.properties, item.boardSpaceId);
  const current: TradeDeedState = { ownerPlayerId: property.ownerPlayerId, houses: property.houses, mortgaged: property.mortgaged };
  if (current.ownerPlayerId !== recorded.ownerPlayerId || current.houses !== recorded.houses || current.mortgaged !== recorded.mortgaged) {
    throw new TradeStateChangedError(item.boardSpaceId, recorded, current);
  }
}

function partyOf(playerId: string, proposer: Player, responder: Player): Player {
  if (playerId === proposer.id) return proposer;
  if (playerId === responder.id) return responder;
  throw new TradePartyMismatchError(`player "${playerId}" is not a party to this trade`);
}

function ensureNoRepeatedDeed(items: readonly TradeProposalItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.boardSpaceId)) {
      throw new TradePartyMismatchError(`deed "${item.boardSpaceId}" appears more than once in this trade`);
    }
    seen.add(item.boardSpaceId);
  }
}

function requireResolution(boardSpaceId: string, resolution: MortgageResolution | null | undefined): MortgageResolution {
  if (resolution === undefined || resolution === null) {
    throw new MortgageResolutionRequiredError(boardSpaceId);
  }
  return resolution;
}

/** Unlike a price, a side of a trade may legitimately put up no cash at all. */
function validateCash(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new InvalidAmountError(amount);
  }
  return amount;
}

function totalBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}
