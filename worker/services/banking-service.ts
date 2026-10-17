import type {
  BankLoanTransactionRequest,
  BankruptcyRequest,
  CreateTransactionRequest,
  CreateBankingCommandResponse,
  CreatePaymentRequestResponse,
  CreateTransactionResponse,
  JackpotPayoutTransactionRequest,
  LoanIssueTransactionRequest,
  LoanRepaymentTransactionRequest,
  PayRentTransactionRequest,
  PaymentRequest,
  MortgageTransactionRequest,
  PlayerTransactionRequest,
  PropertyBuildTransactionRequest,
  PropertyPurchaseTransactionRequest,
  PropertySellBuildingTransactionRequest,
  PropertyTransferTransactionRequest,
  RedeemMortgageTransactionRequest,
  TileMortgageTransactionRequest,
  ReversalTransactionRequest,
  PaymentRequestActionResponse,
  CreateTradeRequestBody,
  CreateTradeRequestResponse,
  TradeRequest,
  TradeRequestActionResponse,
} from '../../shared/contracts/api.js';
import {
  assertReserveRespected,
  auctionReserve,
  InsufficientAvailableFundsError,
} from '../../shared/domain/auction.js';
import {
  allToPlayer,
  bankToPlayer,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  type BankingOperationResult,
  BankLoanAlreadyActiveError,
  declareBankruptcy,
  issueBankLoan,
  issueLoan,
  jackpotPayout,
  JackpotChangedError,
  JackpotEmptyError,
  LoanNotFoundError,
  MortgageNotFoundError,
  mortgageProperty,
  mortgageTile,
  payRent,
  buildProperty,
  propertyPurchase,
  sellBuilding,
  transferProperties,
  redeemMortgage,
  repayBankLoan,
  repayLoan,
  reverseTransaction,
  toJackpot,
  TransactionAlreadyReversedError,
  TransactionNotFoundError,
} from '../../shared/domain/banking.js';
import type {
  BankLoanCooldown,
  Auction,
  Game,
  Loan,
  Mortgage,
  Player,
  PropertyChange,
  GameProperty,
  Transaction,
} from '../../shared/types/monopoly.js';
import { groupTiles, requireTile, type PropertyContext } from '../../shared/domain/property.js';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { LoanRepository } from '../repositories/loan-repository.js';
import type { MortgageRepository } from '../repositories/mortgage-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import {
  PAYMENT_REQUEST_TTL_MS,
  type PaymentRequestRepository,
} from '../repositories/payment-request-repository.js';
import type { TradeRequestRepository } from '../repositories/trade-request-repository.js';
import type { PropertyRepository } from '../repositories/property-repository.js';
import {
  AppError,
  ConflictError,
  DatabaseError,
  PersistenceConsistencyError,
  ResourceNotFoundError,
  TileRequiredError,
  ValidationError,
} from './errors.js';
import { loadBankLoanView } from './bank-loan-view.js';
import { assertBoardEnabled, assertRuleEnabled } from './rule-guard.js';
import { propertyNameKey } from '../../shared/domain/mortgage.js';

export interface BankingService {
  createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateBankingCommandResponse>;
  /** The PENDING requests the given wallets must answer (approver) or started (creator). */
  listPaymentRequests(gameId: string, playerIds: readonly string[]): Promise<PaymentRequest[]>;
  acceptPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  declinePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  cancelPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  getPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest | null>;
  /** The PENDING trades the given wallets must answer (counterparty) or proposed (proposer). */
  listTradeRequests(gameId: string, playerIds: readonly string[]): Promise<TradeRequest[]>;
  getTradeRequest(gameId: string, requestId: string): Promise<TradeRequest | null>;
  createTradeRequest(
    gameId: string,
    request: CreateTradeRequestBody,
  ): Promise<CreateTradeRequestResponse>;
  acceptTradeRequest(gameId: string, requestId: string): Promise<TradeRequestActionResponse>;
  declineTradeRequest(gameId: string, requestId: string): Promise<TradeRequestActionResponse>;
  cancelTradeRequest(gameId: string, requestId: string): Promise<TradeRequestActionResponse>;
  getTransaction(gameId: string, transactionId: string): Promise<Transaction | null>;
  listTransactions(gameId: string, limit: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit: number): Promise<Transaction[]>;
  declareBankruptcy(gameId: string, request: BankruptcyRequest): Promise<CreateTransactionResponse>;
}

export interface BankingServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  paymentRequests: PaymentRequestRepository;
  /** Needed by board games for trade requests. */
  tradeRequests?: TradeRequestRepository;
  mortgages: MortgageRepository;
  loans: LoanRepository;
  /** Needed by games with the auctions rule: the leading bid is reserved on the leader's wallet. */
  auctions?: AuctionRepository;
  /** Needed by board games: the registry the tile requests read and the stored changes. */
  properties?: PropertyRepository;
  createId: () => string;
}

export class DefaultBankingService implements BankingService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly transactions: TransactionRepository;
  private readonly operations: BankingOperationRepository;
  private readonly paymentRequests: PaymentRequestRepository;
  private readonly tradeRequests: TradeRequestRepository | undefined;
  private readonly mortgages: MortgageRepository;
  private readonly loans: LoanRepository;
  private readonly auctions: AuctionRepository | undefined;
  private readonly properties: PropertyRepository | undefined;
  private readonly createId: () => string;

  constructor(dependencies: BankingServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.transactions = dependencies.transactions;
    this.operations = dependencies.operations;
    this.paymentRequests = dependencies.paymentRequests;
    this.tradeRequests = dependencies.tradeRequests;
    this.mortgages = dependencies.mortgages;
    this.loans = dependencies.loans;
    this.auctions = dependencies.auctions;
    this.properties = dependencies.properties;
    this.createId = dependencies.createId;
  }

  async createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateBankingCommandResponse> {
    // A trade moves another player's tiles and cash, so it only happens through a trade request
    // the counterparty accepted (`acceptTradeRequest`), never as a direct transaction.
    if (request.type === 'PROPERTY_TRANSFER')
      throw new ConflictError(
        'TRADE_REQUEST_REQUIRED',
        'A trade must be proposed as a trade request and accepted by the other player.',
      );
    return this.commit(gameId, request);
  }

  /**
   * The single `PROPERTY_TRANSFER` operation of an accepted trade. Internal: the public
   * `createTransaction` refuses this type. With `tradeRequestId` the request flips to ACCEPTED in
   * the same D1 batch as the ledger and registry writes.
   */
  async executeTradeTransfer(
    gameId: string,
    request: PropertyTransferTransactionRequest,
    tradeRequestId?: string,
  ): Promise<CreateBankingCommandResponse> {
    return this.commit(gameId, request, tradeRequestId);
  }

  private async commit(
    gameId: string,
    request: CreateTransactionRequest,
    tradeRequestId?: string,
  ): Promise<CreateBankingCommandResponse> {
    const transactionId = this.createId();
    const existing = await this.transactions.getById(gameId, transactionId);
    if (existing !== null) {
      const players = await this.players.listByGameId(gameId);
      const replayGame = await this.games.getById(gameId);
      return {
        transaction: existing,
        players,
        ...(await this.mortgagesFor(gameId, existing.type)),
        ...(await this.loansFor(replayGame, players, existing.type)),
        ...(await this.jackpotFor(replayGame)),
        ...(await this.propertiesFor(replayGame, existing.id)),
      };
    }
    const game = await this.games.getById(gameId);
    if (game === null) {
      throw new ResourceNotFoundError('Game');
    }
    const players = await this.players.listByGameId(gameId);
    // A player loan is always offered to the lender first, whatever the game payment mode.
    if (request.type === 'LOAN_ISSUE' && request.lenderKind !== 'BANK') {
      assertRuleEnabled(game, 'playerLoans');
      return this.createLoanRequest(game, request, players, transactionId);
    }
    if (request.type === 'TO_JACKPOT' || request.type === 'JACKPOT_PAYOUT')
      assertRuleEnabled(game, 'freeParkingJackpot');
    if (request.type === 'LOAN_ISSUE') assertRuleEnabled(game, 'bankLoans');
    // A repayment is gated by the kind of loan it pays, checked once the loan is read.
    if (request.type === 'LOAN_REPAYMENT' && !game.rules.bankLoans)
      assertRuleEnabled(game, 'playerLoans');
    if (
      game.paymentMode === 'CONFIRMATION' &&
      (request.type === 'PLAYER_TO_PLAYER' || request.type === 'ALL_TO_PLAYER')
    ) {
      return this.createConfirmationRequests(game, gameId, request, players, transactionId);
    }
    if (request.type === 'PASS_GO' && request.exactLanding === true)
      assertRuleEnabled(game, 'doubleRewardOnExactGo');
    const result = await this.execute(game, players, request);
    await this.assertAuctionReserveRespected(game, result);
    try {
      await this.operations.persist({
        transactionId,
        transaction: result.transaction,
        balanceChanges: result.affectedPlayers,
        ...(tradeRequestId === undefined ? {} : { acceptTradeRequestId: tradeRequestId }),
        ...(request.type === 'PASS_GO' ||
        request.type === 'REVERSAL' ||
        request.type === 'MORTGAGE' ||
        request.type === 'MORTGAGE_REDEMPTION' ||
        request.type === 'LOAN_REPAYMENT' ||
        request.type === 'JACKPOT_PAYOUT' ||
        request.type === 'PROPERTY_PURCHASE' ||
        request.type === 'PROPERTY_BUILD' ||
        request.type === 'PROPERTY_SELL_BUILDING' ||
        request.type === 'PROPERTY_TRANSFER' ||
        request.type === 'PAY_RENT'
          ? {}
          : { recentAmount: result.transaction.amount }),
      });
    } catch (error) {
      // Two commands for the same property race on the unique active name; say so plainly.
      if (request.type === 'MORTGAGE' && !('tileId' in request) && error instanceof DatabaseError)
        await this.assertNotMortgaged(gameId, request.playerId, result);
      // A tile operation whose registry moved between reading and writing: run it again on the
      // fresh registry so the precise rule (already owned, mortgaged, ...) is what the player sees.
      if (
        error instanceof DatabaseError &&
        request.type !== 'REVERSAL' &&
        result.transaction.registryChanges !== undefined
      )
        await this.execute(game, await this.players.listByGameId(gameId), request);
      // Two bank loans for one player race on the unique active loan; the loser says so plainly.
      if (request.type === 'LOAN_ISSUE' && error instanceof DatabaseError)
        await this.assertNoActiveBankLoan(gameId, request.playerId);
      // The pot changed (or was collected) between reading it and writing the payout.
      if (request.type === 'JACKPOT_PAYOUT' && error instanceof DatabaseError)
        await this.assertJackpotUnchanged(gameId, result);
      // Two reversals of one transaction race on its UNIQUE link; the loser reports it plainly.
      if (request.type === 'REVERSAL' && error instanceof DatabaseError) {
        const original = await this.transactions.getById(gameId, request.transactionId);
        if (original?.reversedByTransactionId != null)
          throw new TransactionAlreadyReversedError(original.id, original.reversedByTransactionId);
      }
      throw error;
    }

    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) {
      throw new PersistenceConsistencyError();
    }

    const updatedPlayers = await this.players.listByGameId(gameId);
    return {
      transaction,
      players: updatedPlayers,
      ...(await this.mortgagesFor(
        gameId,
        transaction.type,
        result.transaction.mortgageReversal !== undefined ||
          mortgagesMoved(result.transaction.registryChanges),
      )),
      ...(await this.loansFor(game, updatedPlayers, transaction.type)),
      ...(await this.jackpotFor(game)),
      ...(await this.propertiesFor(game, transactionId)),
    };
  }

  private async execute(
    game: Game,
    players: Player[],
    request: CreateTransactionRequest,
  ): Promise<BankingOperationResult> {
    switch (request.type) {
      case 'REVERSAL':
        return this.reverse(game, players, request);
      case 'LOAN_ISSUE':
        return this.issueFromBank(game, players, request as BankLoanTransactionRequest);
      case 'MORTGAGE':
        return 'tileId' in request
          ? this.mortgageBoardTile(game, players, request)
          : this.mortgage(game, players, request);
      case 'MORTGAGE_REDEMPTION':
        return this.redeem(game, players, request);
      case 'LOAN_REPAYMENT':
        return this.repay(game, players, request);
      case 'JACKPOT_PAYOUT':
        return this.collectJackpot(game, players, request);
      case 'PROPERTY_PURCHASE':
        return this.purchase(game, players, request);
      case 'PROPERTY_BUILD':
      case 'PROPERTY_SELL_BUILDING':
        return this.building(game, players, request);
      case 'PROPERTY_TRANSFER':
        return this.transfer(game, players, request);
      case 'PAY_RENT':
        return this.rent(game, players, request);
      default:
        return executeOperation(game, players, request);
    }
  }

  /** The board and the registry of a board game; tile requests to any other game are refused. */
  private async propertyContext(game: Game, tileId?: string): Promise<PropertyContext> {
    const board = assertBoardEnabled(game);
    if (this.properties === undefined) throw new PersistenceConsistencyError();
    const context = { board, registry: await this.properties.listByGame(game.id) };
    if (tileId !== undefined) {
      requireTile(board, tileId);
      // Seeded with the game; a missing row would make the guarded write silently do nothing.
      if (!context.registry.some((row) => row.tileId === tileId))
        throw new PersistenceConsistencyError();
    }
    return context;
  }

  /**
   * The registry rows an operation changed (every row after a bankruptcy), carried by the response
   * of a board game so clients can merge them by tile id.
   */
  private async propertiesFor(
    game: Game | null,
    transactionId: string,
    all = false,
  ): Promise<{ properties: GameProperty[] } | Record<string, never>> {
    if (game?.settings?.board == null || this.properties === undefined) return {};
    const registry = await this.properties.listByGame(game.id);
    if (all) return { properties: registry };
    const changes = await this.properties.listChanges(game.id, transactionId);
    if (changes.length === 0) return {};
    const tileIds = new Set(changes.map((change) => change.tileId));
    return { properties: registry.filter((row) => tileIds.has(row.tileId)) };
  }

  private async mortgageBoardTile(
    game: Game,
    players: Player[],
    request: TileMortgageTransactionRequest,
  ): Promise<BankingOperationResult> {
    const property = await this.propertyContext(game, request.tileId);
    return mortgageTile({
      game,
      players,
      playerId: request.playerId,
      tileId: request.tileId,
      property,
    });
  }

  private async purchase(
    game: Game,
    players: Player[],
    request: PropertyPurchaseTransactionRequest,
  ): Promise<BankingOperationResult> {
    const property = await this.propertyContext(game, request.tileId);
    // A tile being auctioned is sold by the auction, not bought from the bank meanwhile.
    const auction = await this.runningAuction(game);
    if (auction?.tileId === request.tileId)
      throw new ConflictError('PROPERTY_IN_AUCTION', 'This property is being auctioned.', {
        tileId: request.tileId,
        auctionId: auction.id,
      });
    return propertyPurchase({
      game,
      players,
      playerId: request.playerId,
      tileId: request.tileId,
      property,
      ...(request.priceOverride === undefined ? {} : { priceOverride: request.priceOverride }),
    });
  }

  private async building(
    game: Game,
    players: Player[],
    request: PropertyBuildTransactionRequest | PropertySellBuildingTransactionRequest,
  ): Promise<BankingOperationResult> {
    const property = await this.propertyContext(game, request.tileId);
    const command = {
      game,
      players,
      playerId: request.playerId,
      property,
      ...(request.tileId === undefined ? {} : { tileId: request.tileId }),
      ...(request.targets === undefined ? {} : { targets: request.targets }),
    };
    return request.type === 'PROPERTY_BUILD' ? buildProperty(command) : sellBuilding(command);
  }

  private async transfer(
    game: Game,
    players: Player[],
    request: PropertyTransferTransactionRequest,
  ): Promise<BankingOperationResult> {
    const property = await this.propertyContext(game);
    return transferProperties({
      game,
      players,
      playerId: request.playerId,
      counterpartyPlayerId: request.counterpartyPlayerId,
      giveTileIds: request.giveTileIds,
      takeTileIds: request.takeTileIds,
      cashGive: request.cashGive ?? 0,
      cashTake: request.cashTake ?? 0,
      property,
    });
  }

  private async rent(
    game: Game,
    players: Player[],
    request: PayRentTransactionRequest,
  ): Promise<BankingOperationResult> {
    const property = await this.propertyContext(game, request.tileId);
    return payRent({
      game,
      players,
      payerPlayerId: request.payerPlayerId,
      tileId: request.tileId,
      ...(request.diceSum === undefined ? {} : { diceSum: request.diceSum }),
      property,
    });
  }

  /** The running auction of a game with the rule, else null: zero cost for every other game. */
  private async runningAuction(game: Game): Promise<Auction | null> {
    return game.rules.auctions && this.auctions !== undefined
      ? this.auctions.getActive(game.id)
      : null;
  }

  /**
   * Every debit must leave the leading bidder of a running auction their reserved bid. The
   * balances the operation read (balanceBefore) are untouched; this only refuses the operation.
   */
  private async assertAuctionReserveRespected(
    game: Game,
    result: BankingOperationResult,
  ): Promise<void> {
    if (result.transaction.settlesAuction !== undefined) return;
    assertReserveRespected(result.affectedPlayers, await this.runningAuction(game));
  }

  /** The Free Parking pot, carried by every response of a game with the jackpot rule. */
  private async jackpotFor(
    game: Game | null,
  ): Promise<{ jackpot: number } | Record<string, never>> {
    return game?.rules.freeParkingJackpot === true
      ? { jackpot: await this.games.getJackpot(game.id) }
      : {};
  }

  /** Collects the whole pot; its amount is read here, never taken from the client. */
  private async collectJackpot(
    game: Game,
    players: Player[],
    request: JackpotPayoutTransactionRequest,
  ): Promise<BankingOperationResult> {
    return jackpotPayout({
      game,
      players,
      playerId: request.playerId,
      jackpot: await this.games.getJackpot(game.id),
      expectedAmount: request.expectedAmount,
    });
  }

  /**
   * A payout is guarded by the pot it read. When the write fails, say why: the pot was collected
   * meanwhile (JACKPOT_EMPTY) or changed after it was read (JACKPOT_CHANGED, retry to see the new
   * amount). Any other failure is rethrown unchanged.
   */
  private async assertJackpotUnchanged(
    gameId: string,
    result: BankingOperationResult,
  ): Promise<void> {
    const expected =
      result.transaction.jackpot?.kind === 'COLLECT' ? result.transaction.jackpot.expected : 0;
    const current = await this.games.getJackpot(gameId);
    if (current === 0) throw new JackpotEmptyError();
    if (current !== expected) throw new JackpotChangedError(current, expected);
  }

  /**
   * The active loans. With the bank-loans rule every operation can advance a round, so every
   * response carries them (bank loans with their round) plus the cooldowns; without it, only the
   * operations that change loans do.
   */
  private async loansFor(
    game: Game | null,
    players: readonly Player[],
    type: Transaction['type'],
  ): Promise<{ loans: Loan[]; bankLoanCooldowns?: BankLoanCooldown[] } | Record<string, never>> {
    if (game?.rules.bankLoans === true)
      return loadBankLoanView(
        { loans: this.loans, transactions: this.transactions },
        game.id,
        players,
      );
    return game !== null && (type === 'LOAN_ISSUE' || type === 'LOAN_REPAYMENT')
      ? { loans: await this.loans.listActive(game.id) }
      : {};
  }

  /** Borrows from the bank: paid out at once, no payment request. */
  private async issueFromBank(
    game: Game,
    players: Player[],
    request: BankLoanTransactionRequest,
  ): Promise<BankingOperationResult> {
    const view = await loadBankLoanView(
      { loans: this.loans, transactions: this.transactions },
      game.id,
      players,
    );
    return issueBankLoan({
      game,
      players,
      playerId: request.playerId,
      amount: request.amount,
      activeBankLoan: bankLoanOf(view.loans, request.playerId),
      cooldown: view.bankLoanCooldowns.find((item) => item.playerId === request.playerId) ?? null,
      acknowledgeCooldown: request.acknowledgeCooldown === true,
    });
  }

  private async assertNoActiveBankLoan(gameId: string, playerId: string): Promise<void> {
    const active = bankLoanOf(await this.loans.listActive(gameId), playerId);
    if (active !== null) throw new BankLoanAlreadyActiveError(playerId, active.id);
  }

  private async repay(
    game: Game,
    players: Player[],
    request: LoanRepaymentTransactionRequest,
  ): Promise<BankingOperationResult> {
    const loan = await this.loans.getActive(game.id, request.loanId);
    if (loan === null) throw new LoanNotFoundError(request.loanId);
    if (loan.lenderKind !== 'BANK') {
      assertRuleEnabled(game, 'playerLoans');
      if (request.interestRatePercent !== undefined)
        throw new ValidationError('interestRatePercent applies to bank loans only.', {
          field: 'interestRatePercent',
        });
      return repayLoan({ game, players, playerId: request.playerId, loan, amount: request.amount });
    }
    assertRuleEnabled(game, 'bankLoans');
    if (request.interestRatePercent === undefined)
      throw new ValidationError('interestRatePercent is required to repay a bank loan.', {
        field: 'interestRatePercent',
      });
    const view = await loadBankLoanView(
      { loans: this.loans, transactions: this.transactions },
      game.id,
      players,
    );
    const rounds = view.loans.find((item) => item.id === loan.id)?.rounds;
    if (rounds === undefined) throw new PersistenceConsistencyError();
    return repayBankLoan({
      game,
      players,
      playerId: request.playerId,
      loan,
      amount: request.amount,
      interestRatePercent: request.interestRatePercent,
      suggestedRatePercent: rounds.suggestedRatePercent,
    });
  }

  /**
   * Creates the pending LOAN request the lender must accept. Nothing moves until then, but the
   * amount is reserved on the lender wallet like any pending payment request.
   */
  private async createLoanRequest(
    game: Game,
    request: LoanIssueTransactionRequest,
    players: Player[],
    commandId: string,
  ): Promise<CreatePaymentRequestResponse> {
    // Validates the game, both players, the amount and the lender balance.
    issueLoan({
      game,
      players,
      lenderPlayerId: request.lenderPlayerId,
      borrowerPlayerId: request.borrowerPlayerId,
      amount: request.amount,
    });
    const reserved =
      (await this.paymentRequests.pendingReservedAmount(game.id, request.lenderPlayerId)) +
      auctionReserve(await this.runningAuction(game), request.lenderPlayerId);
    const lender = players.find((player) => player.id === request.lenderPlayerId);
    if (lender === undefined || lender.balance - reserved < request.amount)
      throw new InsufficientAvailableFundsError(
        request.lenderPlayerId,
        (lender?.balance ?? 0) - reserved,
        request.amount,
      );
    const id = commandScopedId(commandId, 0);
    await this.paymentRequests.create({
      id,
      kind: 'LOAN',
      gameId: game.id,
      payerPlayerId: request.lenderPlayerId,
      recipientPlayerId: request.borrowerPlayerId,
      creatorPlayerId: request.borrowerPlayerId,
      approverPlayerId: request.lenderPlayerId,
      amount: request.amount,
      comment: null,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + PAYMENT_REQUEST_TTL_MS).toISOString(),
    });
    return {
      paymentRequests: [(await this.paymentRequests.getById(game.id, id)) as PaymentRequest],
      players,
    };
  }

  /** The active mortgages, but only for the operations that change them. */
  private async mortgagesFor(
    gameId: string,
    type: Transaction['type'],
    reversedMortgage = false,
  ): Promise<{ mortgages: Mortgage[] } | Record<string, never>> {
    return type === 'MORTGAGE' || type === 'MORTGAGE_REDEMPTION' || reversedMortgage
      ? { mortgages: await this.mortgages.listActive(gameId) }
      : {};
  }

  private async mortgage(
    game: Game,
    players: Player[],
    request: MortgageTransactionRequest,
  ): Promise<BankingOperationResult> {
    // A board game mortgages a tile; a free-text property would bypass the registry.
    if (game.settings?.board != null) throw new TileRequiredError();
    const result = mortgageProperty({
      game,
      players,
      playerId: request.playerId,
      propertyName: request.propertyName,
      amount: request.amount,
    });
    await this.assertNotMortgaged(game.id, request.playerId, result);
    return result;
  }

  private async assertNotMortgaged(
    gameId: string,
    playerId: string,
    result: BankingOperationResult,
  ): Promise<void> {
    const name = propertyNameKey(result.transaction.newMortgage?.propertyName ?? '');
    const active = await this.mortgages.listActive(gameId);
    if (
      active.some(
        (item) => item.playerId === playerId && propertyNameKey(item.propertyName) === name,
      )
    )
      throw new ConflictError('MORTGAGE_ALREADY_ACTIVE', 'This property is already mortgaged.', {
        propertyName: result.transaction.newMortgage?.propertyName,
      });
  }

  private async redeem(
    game: Game,
    players: Player[],
    request: RedeemMortgageTransactionRequest,
  ): Promise<BankingOperationResult> {
    const mortgage = await this.mortgages.getActive(game.id, request.mortgageId);
    if (mortgage === null) throw new MortgageNotFoundError(request.mortgageId);
    const property = mortgage.tileId == null ? undefined : await this.propertyContext(game);
    return redeemMortgage({
      game,
      players,
      playerId: request.playerId,
      mortgage,
      ...(property === undefined ? {} : { property }),
    });
  }

  private async reverse(
    game: Game,
    players: Player[],
    request: ReversalTransactionRequest,
  ): Promise<BankingOperationResult> {
    const original = await this.transactions.getById(game.id, request.transactionId);
    if (original === null) throw new TransactionNotFoundError(request.transactionId);
    // The anchor itself comes back first; only what was written after it can depend on it.
    const later = (await this.transactions.listChronologicalSince(game.id, [original.id])).filter(
      (candidate) => candidate.id !== original.id,
    );
    const originalRegistryChanges =
      this.properties !== undefined && (original.tileId != null || original.tileIds !== undefined)
        ? await this.properties.listChanges(game.id, original.id)
        : [];
    const redeemedMortgageId =
      original.type === 'MORTGAGE_REDEMPTION' && original.tileId != null
        ? await this.mortgages.findRedeemedBy(game.id, original.id)
        : null;
    // A purchase can change the rent of its colour group (a full group doubles it).
    const board = game.settings?.board;
    const groupTileIds =
      board == null
        ? []
        : (original.tileIds ?? (original.tileId == null ? [] : [original.tileId])).flatMap(
            (tileId) => {
              const tile = board.tiles.find((item) => item.id === tileId);
              return tile === undefined ? [] : groupTiles(board, tile).map((item) => item.id);
            },
          );
    const result = reverseTransaction({
      game,
      players,
      original,
      later,
      originalRegistryChanges,
      groupTileIds,
      ...(redeemedMortgageId === null ? {} : { redeemedMortgageId }),
      comment: request.comment ?? null,
    });
    // The tiles must still be exactly as the original left them (a bankruptcy may have moved them).
    if (this.properties !== undefined && result.transaction.registryChanges !== undefined)
      assertRegistryMatches(
        await this.properties.listByGame(game.id),
        result.transaction.registryChanges,
      );
    return result;
  }

  async getTransaction(gameId: string, transactionId: string): Promise<Transaction | null> {
    return this.transactions.getById(gameId, transactionId);
  }

  async listPaymentRequests(
    gameId: string,
    payerPlayerIds: readonly string[],
  ): Promise<PaymentRequest[]> {
    return this.paymentRequests.listForPayers(gameId, payerPlayerIds);
  }

  async getPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest | null> {
    await this.paymentRequests.expirePending(gameId);
    return this.paymentRequests.getById(gameId, requestId);
  }

  async acceptPaymentRequest(
    gameId: string,
    requestId: string,
  ): Promise<PaymentRequestActionResponse> {
    await this.paymentRequests.expirePending(gameId);
    const paymentRequest = await this.requirePaymentRequest(gameId, requestId);
    if (paymentRequest.state === 'ACCEPTED') {
      const transaction =
        paymentRequest.transactionId === null
          ? null
          : await this.transactions.getById(gameId, paymentRequest.transactionId);
      if (transaction === null) throw new PersistenceConsistencyError();
      const players = await this.players.listByGameId(gameId);
      return {
        paymentRequest,
        transaction,
        players,
        ...(await this.loansFor(await this.games.getById(gameId), players, transaction.type)),
        ...(await this.jackpotFor(await this.games.getById(gameId))),
      };
    }
    if (paymentRequest.state !== 'PENDING')
      throw new ConflictError(
        'PAYMENT_REQUEST_NOT_PENDING',
        'This payment request is no longer pending.',
      );
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    const players = await this.players.listByGameId(gameId);
    const isLoan = paymentRequest.kind === 'LOAN';
    if (isLoan) assertRuleEnabled(game, 'playerLoans');
    const result = isLoan
      ? issueLoan({
          game,
          players,
          lenderPlayerId: paymentRequest.payerPlayerId,
          borrowerPlayerId: paymentRequest.recipientPlayerId,
          amount: paymentRequest.amount,
        })
      : playerToPlayer({
          game,
          players,
          sourcePlayerId: paymentRequest.payerPlayerId,
          destinationPlayerId: paymentRequest.recipientPlayerId,
          amount: paymentRequest.amount,
          ...(paymentRequest.comment === null ? {} : { comment: paymentRequest.comment }),
        });
    await this.assertAuctionReserveRespected(game, result);
    const transactionId = this.createId();
    await this.paymentRequests.settle({
      requestId,
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });
    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    const accepted = await this.requirePaymentRequest(gameId, requestId);
    const updatedPlayers = await this.players.listByGameId(gameId);
    return {
      paymentRequest: accepted,
      transaction,
      players: updatedPlayers,
      ...(await this.loansFor(game, updatedPlayers, transaction.type)),
      ...(await this.jackpotFor(game)),
    };
  }

  async declinePaymentRequest(
    gameId: string,
    requestId: string,
  ): Promise<PaymentRequestActionResponse> {
    return this.resolvePaymentRequest(gameId, requestId, 'DECLINED');
  }
  async cancelPaymentRequest(
    gameId: string,
    requestId: string,
  ): Promise<PaymentRequestActionResponse> {
    return this.resolvePaymentRequest(gameId, requestId, 'CANCELLED');
  }

  // --- Trade requests -------------------------------------------------------------------------
  // Consent for a trade. Nothing touches the ledger or the registry until the counterparty accepts;
  // accepting re-validates the CURRENT state and runs the one `PROPERTY_TRANSFER` operation.

  private requireTradeRepository(): TradeRequestRepository {
    if (this.tradeRequests === undefined) throw new PersistenceConsistencyError();
    return this.tradeRequests;
  }

  async listTradeRequests(gameId: string, playerIds: readonly string[]): Promise<TradeRequest[]> {
    return this.tradeRequests === undefined
      ? []
      : this.tradeRequests.listPendingForPlayers(gameId, playerIds);
  }

  async getTradeRequest(gameId: string, requestId: string): Promise<TradeRequest | null> {
    const repository = this.requireTradeRepository();
    await repository.expirePending(gameId);
    return repository.getById(gameId, requestId);
  }

  private async requireTradeRequest(gameId: string, requestId: string): Promise<TradeRequest> {
    const tradeRequest = await this.requireTradeRepository().getById(gameId, requestId);
    if (tradeRequest === null) throw new ResourceNotFoundError('Trade request');
    return tradeRequest;
  }

  private tradeTransferOf(
    tradeRequest: Pick<
      TradeRequest,
      | 'proposerPlayerId'
      | 'counterpartyPlayerId'
      | 'giveTileIds'
      | 'takeTileIds'
      | 'cashGive'
      | 'cashTake'
    >,
  ): PropertyTransferTransactionRequest {
    return {
      type: 'PROPERTY_TRANSFER',
      playerId: tradeRequest.proposerPlayerId,
      counterpartyPlayerId: tradeRequest.counterpartyPlayerId,
      giveTileIds: [...tradeRequest.giveTileIds],
      takeTileIds: [...tradeRequest.takeTileIds],
      cashGive: tradeRequest.cashGive,
      cashTake: tradeRequest.cashTake,
    };
  }

  async createTradeRequest(
    gameId: string,
    body: CreateTradeRequestBody,
  ): Promise<CreateTradeRequestResponse> {
    const repository = this.requireTradeRepository();
    await repository.expirePending(gameId);
    const existing = await repository.getById(gameId, body.id);
    if (existing !== null) {
      if (existing.proposerPlayerId !== body.playerId)
        throw new ConflictError('TRADE_REQUEST_EXISTS', 'This trade request id is already used.');
      const sameTiles = (a: string[], b: string[]): boolean =>
        a.length === b.length && a.every((id, index) => id === b[index]);
      if (
        existing.counterpartyPlayerId !== body.counterpartyPlayerId ||
        !sameTiles(existing.giveTileIds, body.giveTileIds) ||
        !sameTiles(existing.takeTileIds, body.takeTileIds) ||
        existing.cashGive !== (body.cashGive ?? 0) ||
        existing.cashTake !== (body.cashTake ?? 0)
      )
        throw new ConflictError('TRADE_REQUEST_EXISTS', 'This trade request id is already used.');
      return { tradeRequest: existing };
    }
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    const players = await this.players.listByGameId(gameId);
    // The same rules as the direct trade (board game, ownership, no buildings, funds for cash and
    // mortgage fees), so a trade that could not be accepted is refused up front.
    const transfer = this.tradeTransferOf({
      proposerPlayerId: body.playerId,
      counterpartyPlayerId: body.counterpartyPlayerId,
      giveTileIds: body.giveTileIds,
      takeTileIds: body.takeTileIds,
      cashGive: body.cashGive ?? 0,
      cashTake: body.cashTake ?? 0,
    });
    const result = await this.transfer(game, players, transfer);
    await this.assertAuctionReserveRespected(game, result);
    await repository.create({
      id: body.id,
      gameId,
      proposerPlayerId: transfer.playerId,
      counterpartyPlayerId: transfer.counterpartyPlayerId,
      giveTileIds: transfer.giveTileIds,
      takeTileIds: transfer.takeTileIds,
      cashGive: transfer.cashGive ?? 0,
      cashTake: transfer.cashTake ?? 0,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + PAYMENT_REQUEST_TTL_MS).toISOString(),
    });
    return { tradeRequest: await this.requireTradeRequest(gameId, body.id) };
  }

  async acceptTradeRequest(gameId: string, requestId: string): Promise<TradeRequestActionResponse> {
    const repository = this.requireTradeRepository();
    await repository.expirePending(gameId);
    const tradeRequest = await this.requireTradeRequest(gameId, requestId);
    if (tradeRequest.state === 'ACCEPTED') {
      const transaction =
        tradeRequest.transactionId === null
          ? null
          : await this.transactions.getById(gameId, tradeRequest.transactionId);
      if (transaction === null) throw new PersistenceConsistencyError();
      const game = await this.games.getById(gameId);
      const players = await this.players.listByGameId(gameId);
      return {
        tradeRequest,
        transaction,
        players,
        ...(await this.propertiesFor(game, transaction.id)),
        ...(await this.mortgagesFor(gameId, transaction.type, true)),
        ...(await this.loansFor(game, players, transaction.type)),
        ...(await this.jackpotFor(game)),
      };
    }
    if (tradeRequest.state !== 'PENDING')
      throw new ConflictError(
        'TRADE_REQUEST_NOT_PENDING',
        'This trade request is no longer pending.',
        { state: tradeRequest.state },
      );
    let committed: CreateBankingCommandResponse;
    try {
      committed = await this.executeTradeTransfer(
        gameId,
        this.tradeTransferOf(tradeRequest),
        requestId,
      );
    } catch (error) {
      if (error instanceof DatabaseError) {
        // The guarded batch rolled back: the request was resolved or expired in the meantime.
        const current = await repository.getById(gameId, requestId);
        if (current !== null && current.state !== 'PENDING')
          throw new ConflictError(
            'TRADE_REQUEST_NOT_PENDING',
            'This trade request is no longer pending.',
            { state: current.state },
          );
      }
      throw staleTradeError(error);
    }
    if (!('transaction' in committed)) throw new PersistenceConsistencyError();
    return {
      ...committed,
      tradeRequest: await this.requireTradeRequest(gameId, requestId),
    };
  }

  async declineTradeRequest(
    gameId: string,
    requestId: string,
  ): Promise<TradeRequestActionResponse> {
    return this.resolveTradeRequest(gameId, requestId, 'DECLINED');
  }

  async cancelTradeRequest(gameId: string, requestId: string): Promise<TradeRequestActionResponse> {
    return this.resolveTradeRequest(gameId, requestId, 'CANCELLED');
  }

  private async resolveTradeRequest(
    gameId: string,
    requestId: string,
    state: 'DECLINED' | 'CANCELLED',
  ): Promise<TradeRequestActionResponse> {
    const repository = this.requireTradeRepository();
    await repository.expirePending(gameId);
    const current = await this.requireTradeRequest(gameId, requestId);
    if (current.state === 'PENDING') await repository.resolve(requestId, state);
    const resolved = await this.requireTradeRequest(gameId, requestId);
    // Repeating the same answer is harmless; any other final state cannot be turned into this one.
    if (resolved.state !== state)
      throw new ConflictError(
        'TRADE_REQUEST_NOT_PENDING',
        'This trade request is no longer pending.',
        { state: resolved.state },
      );
    return { tradeRequest: resolved, players: await this.players.listByGameId(gameId) };
  }

  async listTransactions(gameId: string, limit: number): Promise<Transaction[]> {
    return this.transactions.listByGameId(gameId, limit);
  }

  async listPlayerTransactions(
    gameId: string,
    playerId: string,
    limit: number,
  ): Promise<Transaction[]> {
    const [players, transactions] = await Promise.all([
      this.players.listByGameId(gameId),
      this.transactions.listByPlayerId(gameId, playerId, limit),
    ]);
    if (!players.some((player) => player.id === playerId)) {
      throw new ResourceNotFoundError('Player');
    }
    return transactions;
  }

  async declareBankruptcy(
    gameId: string,
    request: BankruptcyRequest,
  ): Promise<CreateTransactionResponse> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    const players = await this.players.listByGameId(gameId);
    // The bank is paid first from the wallet, at the rate the round tracking suggests right now.
    const bankLoan = game.rules.bankLoans
      ? bankLoanOf(
          (
            await loadBankLoanView(
              { loans: this.loans, transactions: this.transactions },
              gameId,
              players,
            )
          ).loans,
          request.playerId,
        )
      : null;
    const property =
      game.settings?.board != null && this.properties !== undefined
        ? await this.propertyContext(game)
        : undefined;
    const result = declareBankruptcy({
      game,
      players,
      ...request,
      ...(property === undefined ? {} : { property }),
      ...(bankLoan === null
        ? {}
        : {
            bankLoan: {
              loan: bankLoan,
              suggestedRatePercent: bankLoan.rounds?.suggestedRatePercent ?? 0,
            },
          }),
    });
    const transactionId = this.createId();
    const existing = await this.transactions.getById(gameId, transactionId);
    if (existing !== null) {
      const current = await this.players.listByGameId(gameId);
      return {
        transaction: existing,
        players: current,
        mortgages: await this.mortgages.listActive(gameId),
        ...(await this.bankruptcyLoans(game, current)),
        ...(await this.jackpotFor(game)),
        ...(await this.propertiesFor(game, existing.id, true)),
      };
    }
    // The creditor may pay mortgage fees out of their own cash and must keep their leading bid
    // covered; the bankrupt player's own bid is withdrawn in the same batch.
    assertReserveRespected(
      result.affectedPlayers.filter((change) => change.player.id !== request.playerId),
      await this.runningAuction(game),
    );
    await this.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: request.playerId,
      ...(game.rules.auctions ? { withdrawAuctionBid: true } : {}),
      mortgageHeirPlayerId: request.creditorPlayerId ?? null,
      loanHeirPlayerId: request.creditorPlayerId ?? null,
    });
    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    // The bankrupt player's mortgages moved to the creditor or were released, so the list changed.
    const updatedPlayers = await this.players.listByGameId(gameId);
    return {
      transaction,
      players: updatedPlayers,
      mortgages: await this.mortgages.listActive(gameId),
      ...(await this.bankruptcyLoans(game, updatedPlayers)),
      ...(await this.jackpotFor(game)),
      ...(await this.propertiesFor(game, transactionId, true)),
    };
  }

  /** A bankruptcy always reports the loans, since the bankrupt player's were closed or handed over. */
  private async bankruptcyLoans(
    game: Game,
    players: readonly Player[],
  ): Promise<{ loans: Loan[]; bankLoanCooldowns?: BankLoanCooldown[] }> {
    return game.rules.bankLoans
      ? loadBankLoanView({ loans: this.loans, transactions: this.transactions }, game.id, players)
      : { loans: await this.loans.listActive(game.id) };
  }

  private async createConfirmationRequests(
    game: Game,
    gameId: string,
    request: Extract<CreateTransactionRequest, { type: 'PLAYER_TO_PLAYER' | 'ALL_TO_PLAYER' }>,
    players: Awaited<ReturnType<PlayerRepository['listByGameId']>>,
    commandId: string,
  ): Promise<CreatePaymentRequestResponse> {
    const pairs =
      request.type === 'PLAYER_TO_PLAYER'
        ? [
            {
              payerPlayerId: request.sourcePlayerId,
              recipientPlayerId: request.destinationPlayerId,
              creatorPlayerId: request.sourcePlayerId,
              approverPlayerId: request.destinationPlayerId,
              amount: request.amount,
              comment: request.comment ?? null,
            },
          ]
        : players
            .filter((player) => player.id !== request.recipientPlayerId)
            .map((player) => ({
              payerPlayerId: player.id,
              recipientPlayerId: request.recipientPlayerId,
              creatorPlayerId: request.recipientPlayerId,
              approverPlayerId: player.id,
              amount: request.amountPerPlayer,
              comment: request.comment ?? null,
            }));
    const auction = await this.runningAuction(game);
    for (const pair of pairs) {
      const payer = players.find((player) => player.id === pair.payerPlayerId);
      if (payer === undefined || pair.payerPlayerId === pair.recipientPlayerId)
        throw new ConflictError(
          'INVALID_PAYMENT_REQUEST',
          'Payment request participants are invalid.',
        );
      const reserved =
        (await this.paymentRequests.pendingReservedAmount(gameId, payer.id)) +
        auctionReserve(auction, payer.id);
      if (payer.balance - reserved < pair.amount)
        throw new InsufficientAvailableFundsError(payer.id, payer.balance - reserved, pair.amount);
    }
    const expiresAt = new Date(Date.now() + PAYMENT_REQUEST_TTL_MS).toISOString();
    const paymentRequests = await Promise.all(
      pairs.map(async (pair, index) => {
        const id = commandScopedId(commandId, index);
        const paymentRequest: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'> = {
          id,
          kind: 'PAYMENT',
          gameId,
          ...pair,
          state: 'PENDING',
          expiresAt,
        };
        await this.paymentRequests.create(paymentRequest);
        return (await this.paymentRequests.getById(gameId, id)) as PaymentRequest;
      }),
    );
    return { paymentRequests, players };
  }

  private async resolvePaymentRequest(
    gameId: string,
    requestId: string,
    state: 'DECLINED' | 'CANCELLED',
  ): Promise<PaymentRequestActionResponse> {
    await this.paymentRequests.expirePending(gameId);
    const current = await this.requirePaymentRequest(gameId, requestId);
    if (current.state === 'PENDING') await this.paymentRequests.resolve(requestId, state);
    return {
      paymentRequest: await this.requirePaymentRequest(gameId, requestId),
      players: await this.players.listByGameId(gameId),
      ...(await this.jackpotFor(await this.games.getById(gameId))),
    };
  }

  private async requirePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest> {
    const paymentRequest = await this.paymentRequests.getById(gameId, requestId);
    if (paymentRequest === null) throw new ResourceNotFoundError('Payment request');
    return paymentRequest;
  }
}

/** Whether a mortgaged tile changed hands, so the clients' mortgage lists have to be refreshed. */
function mortgagesMoved(changes: readonly PropertyChange[] | undefined): boolean {
  return (
    changes?.some(
      (change) =>
        change.before.mortgaged &&
        change.after.mortgaged &&
        change.before.ownerPlayerId !== change.after.ownerPlayerId,
    ) ?? false
  );
}

/** The player's ACTIVE bank loan, if they have one. */
function bankLoanOf(loans: readonly Loan[], playerId: string): Loan | null {
  return (
    loans.find((loan) => loan.lenderKind === 'BANK' && loan.borrowerPlayerId === playerId) ?? null
  );
}

/** Throws when a tile is not in the state a stored change expects (its before state). */
function assertRegistryMatches(
  registry: readonly GameProperty[],
  changes: readonly PropertyChange[],
): void {
  for (const change of changes) {
    const row = registry.find((candidate) => candidate.tileId === change.tileId);
    if (
      row === undefined ||
      row.ownerPlayerId !== change.before.ownerPlayerId ||
      row.mortgaged !== change.before.mortgaged ||
      row.houses !== change.before.houses
    )
      throw new ConflictError(
        'PROPERTY_CHANGED',
        'The property changed since this transaction, so it cannot be reversed.',
        { tileId: change.tileId },
      );
  }
}

/**
 * A trade that can no longer happen (a tile moved, got built on, a wallet is short) is refused as
 * stale; a plain money shortfall keeps its own code so the player sees whose wallet is short.
 */
function staleTradeError(error: unknown): unknown {
  if (
    !(error instanceof AppError) ||
    error.status >= 500 ||
    error instanceof ConflictError ||
    error.code === 'INSUFFICIENT_FUNDS' ||
    error.code === 'TRADE_REQUEST_NOT_PENDING'
  )
    return error;
  return new ConflictError('TRADE_REQUEST_STALE', 'This trade is no longer possible.', {
    reason: error.code,
  });
}

function commandScopedId(commandId: string, index: number): string {
  return `${commandId.slice(0, -1)}${index.toString(16)}`;
}

function executeOperation(
  game: Parameters<typeof playerToPlayer>[0]['game'],
  players: Parameters<typeof playerToPlayer>[0]['players'],
  request: Exclude<
    PlayerTransactionRequest,
    | MortgageTransactionRequest
    | TileMortgageTransactionRequest
    | PropertyPurchaseTransactionRequest
    | PropertyBuildTransactionRequest
    | PropertySellBuildingTransactionRequest
    | PropertyTransferTransactionRequest
    | PayRentTransactionRequest
    | RedeemMortgageTransactionRequest
    | LoanIssueTransactionRequest
    | LoanRepaymentTransactionRequest
    | BankLoanTransactionRequest
    | JackpotPayoutTransactionRequest
  >,
): BankingOperationResult {
  switch (request.type) {
    case 'PLAYER_TO_PLAYER':
      return playerToPlayer({ ...request, game, players });
    case 'PLAYER_TO_BANK':
      return playerToBank({ ...request, game, players });
    case 'BANK_TO_PLAYER':
      return bankToPlayer({ ...request, game, players });
    case 'PLAYER_TO_ALL':
      return playerToAll({ ...request, game, players });
    case 'ALL_TO_PLAYER':
      return allToPlayer({ ...request, game, players });
    case 'PASS_GO':
      return passGo({ ...request, game, players });
    case 'TO_JACKPOT':
      return toJackpot({ ...request, game, players });
  }
}
