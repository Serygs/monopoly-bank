import type {
  BankruptcyRequest,
  CreateTransactionRequest,
  CreateBankingCommandResponse,
  CreatePaymentRequestResponse,
  CreateTransactionResponse,
  LoanIssueTransactionRequest,
  LoanRepaymentTransactionRequest,
  PaymentRequest,
  MortgageTransactionRequest,
  PlayerTransactionRequest,
  RedeemMortgageTransactionRequest,
  ReversalTransactionRequest,
  PaymentRequestActionResponse,
} from '../../shared/contracts/api.js';
import {
  allToPlayer,
  bankToPlayer,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  type BankingOperationResult,
  declareBankruptcy,
  issueLoan,
  LoanNotFoundError,
  MortgageNotFoundError,
  mortgageProperty,
  redeemMortgage,
  repayLoan,
  reverseTransaction,
  TransactionAlreadyReversedError,
  TransactionNotFoundError,
} from '../../shared/domain/banking.js';
import type { Game, Loan, Mortgage, Player, Transaction } from '../../shared/types/monopoly.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { LoanRepository } from '../repositories/loan-repository.js';
import type { MortgageRepository } from '../repositories/mortgage-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import type { PaymentRequestRepository } from '../repositories/payment-request-repository.js';
import {
  ConflictError,
  DatabaseError,
  PersistenceConsistencyError,
  ResourceNotFoundError,
} from './errors.js';
import { assertRuleEnabled } from './rule-guard.js';
import { propertyNameKey } from '../../shared/domain/mortgage.js';

export interface BankingService {
  createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateBankingCommandResponse>;
  listPaymentRequests(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]>;
  acceptPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  declinePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  cancelPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  getPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest | null>;
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
  mortgages: MortgageRepository;
  loans: LoanRepository;
  createId: () => string;
}

export class DefaultBankingService implements BankingService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly transactions: TransactionRepository;
  private readonly operations: BankingOperationRepository;
  private readonly paymentRequests: PaymentRequestRepository;
  private readonly mortgages: MortgageRepository;
  private readonly loans: LoanRepository;
  private readonly createId: () => string;

  constructor(dependencies: BankingServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.transactions = dependencies.transactions;
    this.operations = dependencies.operations;
    this.paymentRequests = dependencies.paymentRequests;
    this.mortgages = dependencies.mortgages;
    this.loans = dependencies.loans;
    this.createId = dependencies.createId;
  }

  async createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateBankingCommandResponse> {
    const transactionId = this.createId();
    const existing = await this.transactions.getById(gameId, transactionId);
    if (existing !== null)
      return {
        transaction: existing,
        players: await this.players.listByGameId(gameId),
        ...(await this.mortgagesFor(gameId, existing.type)),
        ...(await this.loansFor(gameId, existing.type)),
      };
    const game = await this.games.getById(gameId);
    if (game === null) {
      throw new ResourceNotFoundError('Game');
    }
    const players = await this.players.listByGameId(gameId);
    if (request.type === 'LOAN_ISSUE' || request.type === 'LOAN_REPAYMENT')
      assertRuleEnabled(game, 'playerLoans');
    // A loan is always offered to the lender first, whatever the game payment mode.
    if (request.type === 'LOAN_ISSUE')
      return this.createLoanRequest(game, request, players, transactionId);
    if (
      game.paymentMode === 'CONFIRMATION' &&
      (request.type === 'PLAYER_TO_PLAYER' || request.type === 'ALL_TO_PLAYER')
    ) {
      return this.createConfirmationRequests(gameId, request, players, transactionId);
    }
    if (request.type === 'PASS_GO' && request.exactLanding === true)
      assertRuleEnabled(game, 'doubleRewardOnExactGo');
    const result =
      request.type === 'REVERSAL'
        ? await this.reverse(game, players, request)
        : request.type === 'MORTGAGE'
          ? await this.mortgage(game, players, request)
          : request.type === 'MORTGAGE_REDEMPTION'
            ? await this.redeem(game, players, request)
            : request.type === 'LOAN_REPAYMENT'
              ? await this.repay(game, players, request)
              : executeOperation(game, players, request);
    try {
      await this.operations.persist({
        transactionId,
        transaction: result.transaction,
        balanceChanges: result.affectedPlayers,
        ...(request.type === 'PASS_GO' ||
        request.type === 'REVERSAL' ||
        request.type === 'MORTGAGE' ||
        request.type === 'MORTGAGE_REDEMPTION' ||
        request.type === 'LOAN_REPAYMENT'
          ? {}
          : { recentAmount: result.transaction.amount }),
      });
    } catch (error) {
      // Two commands for the same property race on the unique active name; say so plainly.
      if (request.type === 'MORTGAGE' && error instanceof DatabaseError)
        await this.assertNotMortgaged(gameId, request.playerId, result);
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

    return {
      transaction,
      players: await this.players.listByGameId(gameId),
      ...(await this.mortgagesFor(gameId, transaction.type)),
      ...(await this.loansFor(gameId, transaction.type)),
    };
  }

  /** The active loans, but only for the operations that change them. */
  private async loansFor(
    gameId: string,
    type: Transaction['type'],
  ): Promise<{ loans: Loan[] } | Record<string, never>> {
    return type === 'LOAN_ISSUE' || type === 'LOAN_REPAYMENT'
      ? { loans: await this.loans.listActive(gameId) }
      : {};
  }

  private async repay(
    game: Game,
    players: Player[],
    request: LoanRepaymentTransactionRequest,
  ): Promise<BankingOperationResult> {
    const loan = await this.loans.getActive(game.id, request.loanId);
    if (loan === null) throw new LoanNotFoundError(request.loanId);
    return repayLoan({ game, players, playerId: request.playerId, loan, amount: request.amount });
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
    const reserved = await this.paymentRequests.pendingReservedAmount(
      game.id,
      request.lenderPlayerId,
    );
    const lender = players.find((player) => player.id === request.lenderPlayerId);
    if (lender === undefined || lender.balance - reserved < request.amount)
      throw new ConflictError(
        'INSUFFICIENT_AVAILABLE_FUNDS',
        'Player does not have enough available funds.',
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
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
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
  ): Promise<{ mortgages: Mortgage[] } | Record<string, never>> {
    return type === 'MORTGAGE' || type === 'MORTGAGE_REDEMPTION'
      ? { mortgages: await this.mortgages.listActive(gameId) }
      : {};
  }

  private async mortgage(
    game: Game,
    players: Player[],
    request: MortgageTransactionRequest,
  ): Promise<BankingOperationResult> {
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
    return redeemMortgage({ game, players, playerId: request.playerId, mortgage });
  }

  private async reverse(
    game: Game,
    players: Player[],
    request: ReversalTransactionRequest,
  ): Promise<BankingOperationResult> {
    const original = await this.transactions.getById(game.id, request.transactionId);
    if (original === null) throw new TransactionNotFoundError(request.transactionId);
    return reverseTransaction({ game, players, original, comment: request.comment ?? null });
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
      return {
        paymentRequest,
        transaction,
        players: await this.players.listByGameId(gameId),
        ...(paymentRequest.kind === 'LOAN' ? { loans: await this.loans.listActive(gameId) } : {}),
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
    return {
      paymentRequest: accepted,
      transaction,
      players: await this.players.listByGameId(gameId),
      ...(isLoan ? { loans: await this.loans.listActive(gameId) } : {}),
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
    const result = declareBankruptcy({ game, players, ...request });
    const transactionId = this.createId();
    const existing = await this.transactions.getById(gameId, transactionId);
    if (existing !== null)
      return {
        transaction: existing,
        players: await this.players.listByGameId(gameId),
        mortgages: await this.mortgages.listActive(gameId),
        loans: await this.loans.listActive(gameId),
      };
    await this.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: request.playerId,
      mortgageHeirPlayerId: request.creditorPlayerId ?? null,
      loanHeirPlayerId: request.creditorPlayerId ?? null,
    });
    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    // The bankrupt player's mortgages moved to the creditor or were released, so the list changed.
    return {
      transaction,
      players: await this.players.listByGameId(gameId),
      mortgages: await this.mortgages.listActive(gameId),
      loans: await this.loans.listActive(gameId),
    };
  }

  private async createConfirmationRequests(
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
    for (const pair of pairs) {
      const payer = players.find((player) => player.id === pair.payerPlayerId);
      if (payer === undefined || pair.payerPlayerId === pair.recipientPlayerId)
        throw new ConflictError(
          'INVALID_PAYMENT_REQUEST',
          'Payment request participants are invalid.',
        );
      const reserved = await this.paymentRequests.pendingReservedAmount(gameId, payer.id);
      if (payer.balance - reserved < pair.amount)
        throw new ConflictError(
          'INSUFFICIENT_AVAILABLE_FUNDS',
          'Player does not have enough available funds.',
        );
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
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
    };
  }

  private async requirePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest> {
    const paymentRequest = await this.paymentRequests.getById(gameId, requestId);
    if (paymentRequest === null) throw new ResourceNotFoundError('Payment request');
    return paymentRequest;
  }
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
    | RedeemMortgageTransactionRequest
    | LoanIssueTransactionRequest
    | LoanRepaymentTransactionRequest
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
  }
}
