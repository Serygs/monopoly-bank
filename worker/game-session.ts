import type { AuctionResponse, GameDetails } from '../shared/contracts/api.js';
import {
  isLiveMutationCommand,
  type GameVersionResponse,
  type LiveGameState,
  type LiveMutationCommand,
  type LiveServerEvent,
} from '../shared/contracts/live.js';
import { AuctionNotFoundError } from '../shared/domain/auction.js';
import { TransactionNotFoundError } from '../shared/domain/banking.js';
import { controlledPlayerIdForBankingCommand } from '../shared/domain/player-control.js';
import type {
  BankLoanCooldown,
  GameProperty,
  Loan,
  Mortgage,
  Player,
  Transaction,
} from '../shared/types/monopoly.js';
import { D1AuctionRepository } from './repositories/auction-repository.js';
import { D1BankingOperationRepository } from './repositories/banking-operation-repository.js';
import {
  D1CommandLedgerRepository,
  type CommandLedgerEntry,
  type CommandLedgerRepository,
} from './repositories/command-ledger-repository.js';
import { D1GameAccessRepository } from './repositories/game-access-repository.js';
import { D1GameCompletionRepository } from './repositories/game-completion-repository.js';
import { D1GameRepository } from './repositories/game-repository.js';
import { D1GameStatisticsRepository } from './repositories/game-statistics-repository.js';
import { D1LoanRepository } from './repositories/loan-repository.js';
import { D1MortgageRepository } from './repositories/mortgage-repository.js';
import { D1PropertyRepository } from './repositories/property-repository.js';
import { D1PaymentRequestRepository } from './repositories/payment-request-repository.js';
import { D1TradeRequestRepository } from './repositories/trade-request-repository.js';
import { D1PlayerRepository } from './repositories/player-repository.js';
import { D1TransactionRepository } from './repositories/transaction-repository.js';
import { DefaultAuctionService } from './services/auction-service.js';
import { DefaultBankingService } from './services/banking-service.js';
import { ConflictError, ResourceNotFoundError, ValidationError } from './services/errors.js';
import { handleError } from './services/error-handler.js';
import { GameAccessService } from './services/game-access-service.js';
import { DefaultGameService } from './services/game-service.js';
import { ProfileStatisticsService } from './services/profile-statistics-service.js';

/** DO storage key: the running auction's end, so the alarm and lazy settlement know what to do. */
const AUCTION_DEADLINE_KEY = 'auctionDeadline';
interface AuctionDeadline {
  gameId: string;
  auctionId: string;
  /** Milliseconds since the epoch. */
  endsAt: number;
}

/** One coordinator per game. All state-changing game commands enter here. */
export class GameSession {
  private readonly inFlightCommands = new Map<
    string,
    { actorId: string; payloadHash: string; response: Promise<ResponsePayload> }
  >();
  private settling: Promise<AuctionResponse | null> | null = null;
  /** The single FIFO queue every mutation and settlement runs through (see `serialize`). */
  private queue: Promise<unknown> = Promise.resolve();
  /** Whether this instance already looked for a running auction without a stored deadline. */
  private deadlineChecked = false;
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const gameId = request.headers.get('x-game-id');
    const userId = request.headers.get('x-user-id');
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    if (gameId === null || userId === null) return forbidden(requestId);
    const path = new URL(request.url).pathname;
    if (path === '/connect') return this.acceptConnection(gameId, userId, request);
    if (path === '/mutation') return this.mutate(gameId, userId, request);
    if (path === '/auction' && request.method === 'GET')
      return this.readAuction(gameId, userId, request);
    if (path === '/version' && request.method === 'GET') return this.readVersion();
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId } },
      { status: 404, headers: { 'x-request-id': requestId } },
    );
  }

  private async acceptConnection(
    gameId: string,
    userId: string,
    request: Request,
  ): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'WebSocket upgrade required.', requestId } },
        { status: 426, headers: { 'x-request-id': requestId } },
      );
    await this.settleQuietly(gameId);
    const details = await this.gameService().getGame(gameId);
    if (details.game.status === 'FINISHED')
      return Response.json(
        { error: { code: 'GAME_FINISHED', message: 'This game is finished.', requestId } },
        { status: 409, headers: { 'x-request-id': requestId } },
      );
    await this.access().requireMember(gameId, userId);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId });
    this.ctx.acceptWebSocket(server, [userId]);
    this.send(server, { type: 'GAME_SNAPSHOT', state: await this.state(gameId, userId, details) });
    await this.broadcastPresence();
    return new Response(null, {
      status: 101,
      headers: { 'x-request-id': requestId },
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.close(1008, 'Invalid live protocol message.');
      return;
    }
    const payload: unknown = tryJson(message);
    if (!isHeartbeat(payload)) {
      ws.close(1008, 'Commands must use the authenticated API.');
      return;
    }
    this.send(ws, { type: 'HEARTBEAT', stateVersion: await this.stateVersion() });
  }

  async webSocketClose(): Promise<void> {
    await this.broadcastPresence();
  }

  private async readVersion(): Promise<Response> {
    return Response.json({
      data: { stateVersion: await this.stateVersion() } satisfies GameVersionResponse,
    });
  }

  /**
   * The polling fallback for the auction. A due auction is settled first, so a missed alarm cannot
   * leave it stuck; the settlement's payment and players come back only to the call that did it.
   */
  private async readAuction(gameId: string, userId: string, request: Request): Promise<Response> {
    try {
      await this.access().requireMember(gameId, userId);
      const settled = await this.settleQuietly(gameId);
      const auction = settled?.auction ?? (await this.auctions().getCurrent(gameId));
      return Response.json(
        { data: { ...(settled ?? {}), auction } satisfies AuctionResponse },
        { headers: { 'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID() } },
      );
    } catch (error) {
      return handleError(error, { ...context(request, gameId, userId), path: '/auction' });
    }
  }

  /**
   * Settles the running auction if it is due. Used by the alarm and, lazily, before every command
   * and snapshot. One settlement at a time; the system command ID `auction-settle:<auctionId>`
   * goes through the same ledger as client commands, so the state version bumps and the
   * broadcast happen once however many triggers race. Resolves with the closed auction when this
   * call settled it, else null.
   */
  private settleDueAuction(gameId?: string): Promise<AuctionResponse | null> {
    this.settling ??= this.serialize(() => this.runSettlement(gameId)).finally(() => {
      this.settling = null;
    });
    return this.settling;
  }

  /**
   * Runs work strictly one after another (a promise-chain mutex). D1 awaits would otherwise let
   * commands interleave: a debit could pass the auction-reserve check, a bid make its payer the
   * leader, and the debit still commit below the new reserve. A failing task does not poison the
   * queue; the caller still sees its error.
   */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** The lazy triggers must not turn a settlement hiccup into a failed command; the alarm retries. */
  private settleQuietly(gameId?: string): Promise<AuctionResponse | null> {
    return this.settleDueAuction(gameId).catch(() => null);
  }

  private async runSettlement(knownGameId?: string): Promise<AuctionResponse | null> {
    let deadline = await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY);
    // A crash between the D1 insert and the storage write leaves a running auction nobody will
    // settle: once per wake, look for one and arm it from its `ends_at`.
    if (deadline === undefined && knownGameId !== undefined && !this.deadlineChecked) {
      const current = await this.auctions().getCurrent(knownGameId);
      this.deadlineChecked = true;
      if (current?.state === 'ACTIVE') {
        await this.armAuction(knownGameId, current);
        deadline = await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY);
      }
    }
    if (deadline === undefined || Date.now() < deadline.endsAt) return null;
    const { gameId, auctionId } = deadline;
    const commandId = `auction-settle:${auctionId}`;
    const ledger = this.commandLedger();
    const entry = await ledger.claim({
      gameId,
      commandId,
      actorId: 'system',
      commandType: 'AUCTION_SETTLE',
      payloadHash: auctionId,
    });
    if (entry.status === 'COMPLETED') {
      await this.clearAuctionDeadline(auctionId);
      return null;
    }
    let response: AuctionResponse | null;
    try {
      response = await this.auctions().settleDue(gameId, auctionId);
    } catch (error) {
      // The game or auction is gone (purged): nothing is left to settle.
      if (error instanceof AuctionNotFoundError || error instanceof ResourceNotFoundError)
        await this.clearAuctionDeadline(auctionId);
      throw error;
    }
    if (response === null) return null;
    const stateVersion = await this.incrementStateVersion();
    await ledger.complete({
      gameId,
      commandId,
      status: 200,
      result: response,
      transactionId: response.transaction?.id ?? null,
    });
    await this.broadcast({ type: 'AUCTION_UPDATED', stateVersion, auction: response.auction });
    if (response.transaction !== undefined && response.players !== undefined) {
      const details = await this.gameService().getGame(gameId);
      await this.broadcast({
        type: 'GAME_COMMITTED',
        stateVersion,
        transaction: response.transaction,
        players: response.players,
        ...(details.game.rules.bankLoans
          ? {
              loans: details.loans ?? [],
              ...(details.bankLoanCooldowns === undefined
                ? {}
                : { bankLoanCooldowns: details.bankLoanCooldowns }),
            }
          : {}),
        ...(details.jackpot === undefined ? {} : { jackpot: details.jackpot }),
        ...(details.properties === undefined ? {} : { properties: details.properties }),
      });
    }
    await this.clearAuctionDeadline(auctionId);
    return response;
  }

  /** Remembers when the running auction ends and sets the alarm for it. */
  private async armAuction(gameId: string, auction: { id: string; endsAt: string }): Promise<void> {
    this.deadlineChecked = true;
    const endsAt = Date.parse(auction.endsAt);
    await this.ctx.storage.put<AuctionDeadline>(AUCTION_DEADLINE_KEY, {
      gameId,
      auctionId: auction.id,
      endsAt,
    });
    await this.ctx.storage.setAlarm(endsAt);
  }

  /** Clears the deadline only if it still belongs to the auction just settled. */
  private async clearAuctionDeadline(auctionId: string): Promise<void> {
    const stored = await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY);
    if (stored !== undefined && stored.auctionId !== auctionId) return;
    await this.ctx.storage.delete(AUCTION_DEADLINE_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  /** Durable Object alarm: the auction ended. Errors propagate so the platform retries. */
  async alarm(): Promise<void> {
    await this.settleDueAuction();
    const deadline = await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY);
    // Still pending (not due by this clock, or nothing settled): look again shortly.
    if (deadline !== undefined)
      await this.ctx.storage.setAlarm(Math.max(deadline.endsAt, Date.now() + 1000));
  }

  private async mutate(gameId: string, userId: string, request: Request): Promise<Response> {
    const command: unknown = await request.json().catch(() => null);
    if (!isLiveMutationCommand(command))
      return handleError(
        new ValidationError('Invalid live mutation command.'),
        context(request, gameId, userId),
      );
    await this.settleQuietly(gameId);
    try {
      const payloadHash = await commandPayloadHash(command);
      const existing = this.inFlightCommands.get(command.commandId);
      if (
        existing !== undefined &&
        (existing.actorId !== userId || existing.payloadHash !== payloadHash)
      )
        throw new ConflictError(
          'COMMAND_ID_REUSED',
          'This command ID belongs to a different command.',
        );
      const response = await (existing?.response ??
        this.startCommand(gameId, userId, command, payloadHash));
      return Response.json(
        { data: response.data },
        {
          status: response.status,
          headers: { 'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID() },
        },
      );
    } catch (error) {
      return handleError(error, context(request, gameId, userId));
    }
  }

  private startCommand(
    gameId: string,
    userId: string,
    command: LiveMutationCommand,
    payloadHash: string,
  ): Promise<ResponsePayload> {
    const pending = this.serialize(async () => {
      // A due auction is settled first, inside the same slot, so this command sees its result.
      await this.runSettlement(gameId).catch(() => null);
      const ledger = this.commandLedger();
      const entry = await ledger.claim({
        gameId,
        commandId: command.commandId,
        actorId: userId,
        commandType: command.type,
        payloadHash,
      });
      if (entry.status === 'COMPLETED') return replay(entry);
      await this.authorizeMutation(gameId, userId, command);
      const response = await this.execute(gameId, userId, command);
      await this.afterCommit('executed');
      const stateVersion = await this.incrementStateVersion();
      await this.afterCommit('version-incremented');
      await ledger.complete({
        gameId,
        commandId: command.commandId,
        status: response.status,
        result: response.data,
        transactionId: transactionIdFor(response.data),
      });
      await this.afterCommit('ledger-completed');
      await this.publish(command, response.data, stateVersion);
      await this.afterCommit('published');
      return response;
    });
    this.inFlightCommands.set(command.commandId, {
      actorId: userId,
      payloadHash,
      response: pending,
    });
    void pending
      .finally(() => {
        if (this.inFlightCommands.get(command.commandId)?.response === pending)
          this.inFlightCommands.delete(command.commandId);
      })
      .catch(() => undefined);
    return pending;
  }

  private readonly executors: Executors = {
    START_GAME: async (gameId) => ({
      status: 200,
      data: await this.gameService().startGame(gameId),
    }),
    JOIN_LOBBY: async (gameId, userId, command) => {
      await this.access().joinLobby({
        gameId,
        userId,
        playerId: command.playerId,
        nickname: command.nickname,
        color: command.color,
        startingBalance: command.startingBalance,
      });
      return { status: 201, data: await this.gameService().getGame(gameId) };
    },
    REMOVE_PLAYER: async (gameId, userId, command) => {
      await this.access().removeLobbyPlayer(gameId, userId, command.playerId);
      return { status: 200, data: await this.gameService().getGame(gameId) };
    },
    START_AUCTION: async (gameId, _userId, command) => {
      const data = await this.auctions().startAuction(gameId, command.request, command.commandId);
      if (data.auction?.state === 'ACTIVE') await this.armAuction(gameId, data.auction);
      return { status: 201, data };
    },
    PLACE_BID: async (gameId, _userId, command) => {
      const data = await this.auctions().placeBid(gameId, command.request);
      // A late bid moves the end (at least 10 seconds), so the alarm moves with it.
      if (data.auction?.state === 'ACTIVE') await this.armAuction(gameId, data.auction);
      return { status: 200, data };
    },
    CREATE_TRANSACTION: async (gameId, _userId, command) => ({
      status: 201,
      data: await this.banking(command.commandId).createTransaction(gameId, command.request),
    }),
    ACCEPT_PAYMENT_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).acceptPaymentRequest(
        gameId,
        command.paymentRequestId,
      ),
    }),
    DECLINE_PAYMENT_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).declinePaymentRequest(
        gameId,
        command.paymentRequestId,
      ),
    }),
    CANCEL_PAYMENT_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).cancelPaymentRequest(
        gameId,
        command.paymentRequestId,
      ),
    }),
    CREATE_TRADE_REQUEST: async (gameId, _userId, command) => ({
      status: 201,
      data: await this.banking(command.commandId).createTradeRequest(gameId, command.request),
    }),
    ACCEPT_TRADE_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).acceptTradeRequest(
        gameId,
        command.tradeRequestId,
      ),
    }),
    DECLINE_TRADE_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).declineTradeRequest(
        gameId,
        command.tradeRequestId,
      ),
    }),
    CANCEL_TRADE_REQUEST: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.banking(command.commandId).cancelTradeRequest(
        gameId,
        command.tradeRequestId,
      ),
    }),
    DECLARE_BANKRUPTCY: async (gameId, _userId, command) => ({
      status: 201,
      data: await this.banking(command.commandId).declareBankruptcy(gameId, command.request),
    }),
    FINISH_GAME: async (gameId, _userId, command) => ({
      status: 200,
      data: await this.finishGame(gameId, command.winnerPlayerIds),
    }),
  };

  private execute(
    gameId: string,
    userId: string,
    command: LiveMutationCommand,
  ): Promise<ResponsePayload> {
    const run = this.executors[command.type] as (
      gameId: string,
      userId: string,
      command: LiveMutationCommand,
    ) => Promise<ResponsePayload>;
    return run(gameId, userId, command);
  }

  /** Test seam for failures after a durable financial commit; production is a no-op. */
  private afterCommit(
    stage: 'executed' | 'ledger-completed' | 'version-incremented' | 'published',
  ): Promise<void> {
    void stage;
    return Promise.resolve();
  }

  private readonly authorizers: Authorizers = {
    START_GAME: (gameId, userId) => this.access().requireOwner(gameId, userId),
    FINISH_GAME: (gameId, userId) => this.access().requireOwner(gameId, userId),
    REMOVE_PLAYER: (gameId, userId) => this.access().requireOwner(gameId, userId),
    JOIN_LOBBY: async (gameId, userId) => {
      const details = await this.gameService().getGame(gameId);
      if (details.game.status !== 'LOBBY')
        throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
      return this.access().requireLobbySeat(gameId, userId, details.players.length);
    },
    ACCEPT_PAYMENT_REQUEST: (gameId, userId, command) =>
      this.requirePaymentController(gameId, userId, command, 'approverPlayerId'),
    DECLINE_PAYMENT_REQUEST: (gameId, userId, command) =>
      this.requirePaymentController(gameId, userId, command, 'approverPlayerId'),
    CANCEL_PAYMENT_REQUEST: (gameId, userId, command) =>
      this.requirePaymentController(gameId, userId, command, 'creatorPlayerId'),
    ACCEPT_TRADE_REQUEST: (gameId, userId, command) =>
      this.requireTradeController(gameId, userId, command, 'counterpartyPlayerId'),
    DECLINE_TRADE_REQUEST: (gameId, userId, command) =>
      this.requireTradeController(gameId, userId, command, 'counterpartyPlayerId'),
    CANCEL_TRADE_REQUEST: (gameId, userId, command) =>
      this.requireTradeController(gameId, userId, command, 'proposerPlayerId'),
    CREATE_TRADE_REQUEST: (gameId, userId, command) =>
      this.requireMemberController(gameId, userId, command.request.playerId),
    START_AUCTION: (gameId, userId, command) =>
      this.requireMemberController(gameId, userId, command.request.initiatorPlayerId),
    PLACE_BID: (gameId, userId, command) =>
      this.requireMemberController(gameId, userId, command.request.bidderPlayerId),
    CREATE_TRANSACTION: (gameId, userId, command) =>
      this.authorizeBankingRequest(gameId, userId, command),
    DECLARE_BANKRUPTCY: (gameId, userId, command) =>
      this.authorizeBankingRequest(gameId, userId, command),
  };

  private authorizeMutation(
    gameId: string,
    userId: string,
    command: LiveMutationCommand,
  ): Promise<void> {
    const authorize = this.authorizers[command.type] as (
      gameId: string,
      userId: string,
      command: LiveMutationCommand,
    ) => Promise<void>;
    return authorize(gameId, userId, command);
  }

  private async requirePaymentController(
    gameId: string,
    userId: string,
    command: { commandId: string; paymentRequestId: string },
    side: 'approverPlayerId' | 'creatorPlayerId',
  ): Promise<void> {
    const paymentRequest = await this.banking(command.commandId).getPaymentRequest(
      gameId,
      command.paymentRequestId,
    );
    if (paymentRequest === null) throw new ValidationError('Payment request not found.');
    return this.access().requirePlayerController(gameId, userId, paymentRequest[side]);
  }

  // The counterparty answers; only the proposer withdraws.
  private async requireTradeController(
    gameId: string,
    userId: string,
    command: { commandId: string; tradeRequestId: string },
    side: 'counterpartyPlayerId' | 'proposerPlayerId',
  ): Promise<void> {
    const tradeRequest = await this.banking(command.commandId).getTradeRequest(
      gameId,
      command.tradeRequestId,
    );
    if (tradeRequest === null) throw new ValidationError('Trade request not found.');
    return this.access().requirePlayerController(gameId, userId, tradeRequest[side]);
  }

  private async requireMemberController(
    gameId: string,
    userId: string,
    playerId: string,
  ): Promise<void> {
    await this.access().requireMember(gameId, userId);
    return this.access().requirePlayerController(gameId, userId, playerId);
  }

  private async authorizeBankingRequest(
    gameId: string,
    userId: string,
    command: CommandOf<'CREATE_TRANSACTION' | 'DECLARE_BANKRUPTCY'>,
  ): Promise<void> {
    const access = this.access();
    await access.requireMember(gameId, userId);
    const { request } = command;
    if ('type' in request && request.type === 'REVERSAL') {
      const original = await this.banking(command.commandId).getTransaction(
        gameId,
        request.transactionId,
      );
      if (original === null) throw new TransactionNotFoundError(request.transactionId);
      return access.requireReversalAuthority(gameId, userId, original);
    }
    await access.requirePlayerController(
      gameId,
      userId,
      controlledPlayerIdForBankingCommand(request),
    );
  }

  private async publish(
    command: LiveMutationCommand,
    data: unknown,
    stateVersion: number,
  ): Promise<void> {
    if (
      command.type === 'START_GAME' ||
      command.type === 'JOIN_LOBBY' ||
      command.type === 'REMOVE_PLAYER'
    ) {
      const details = data as GameDetails;
      await this.broadcast({
        type: 'LOBBY_UPDATED',
        stateVersion,
        details: { game: details.game, players: details.players },
      });
      return;
    }
    if (command.type === 'FINISH_GAME') {
      await this.broadcast({ type: 'GAME_FINISHED', stateVersion, details: data as GameDetails });
      return;
    }
    if (command.type === 'START_AUCTION' || command.type === 'PLACE_BID') {
      await this.broadcast({
        type: 'AUCTION_UPDATED',
        stateVersion,
        auction: (data as AuctionResponse).auction,
      });
      return;
    }
    if (command.type === 'CREATE_TRANSACTION' && 'paymentRequests' in (data as object)) {
      await this.broadcast({ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion });
      return;
    }
    const result = data as {
      transaction?: Transaction;
      players?: Player[];
      mortgages?: Mortgage[];
      loans?: Loan[];
      bankLoanCooldowns?: BankLoanCooldown[];
      jackpot?: number;
      properties?: GameProperty[];
    };
    if (result.transaction !== undefined && result.players !== undefined)
      await this.broadcast({
        type: 'GAME_COMMITTED',
        stateVersion,
        transaction: result.transaction,
        players: result.players,
        ...(result.mortgages === undefined ? {} : { mortgages: result.mortgages }),
        ...(result.loans === undefined ? {} : { loans: result.loans }),
        ...(result.bankLoanCooldowns === undefined
          ? {}
          : { bankLoanCooldowns: result.bankLoanCooldowns }),
        ...(result.jackpot === undefined ? {} : { jackpot: result.jackpot }),
        ...(result.properties === undefined ? {} : { properties: result.properties }),
        ...(command.type === 'DECLARE_BANKRUPTCY'
          ? { bankruptPlayerId: command.request.playerId }
          : {}),
      });
    if (
      command.type === 'ACCEPT_PAYMENT_REQUEST' ||
      command.type === 'DECLINE_PAYMENT_REQUEST' ||
      command.type === 'CANCEL_PAYMENT_REQUEST' ||
      command.type === 'DECLARE_BANKRUPTCY'
    )
      await this.broadcast({ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion });
    if (
      command.type === 'CREATE_TRADE_REQUEST' ||
      command.type === 'ACCEPT_TRADE_REQUEST' ||
      command.type === 'DECLINE_TRADE_REQUEST' ||
      command.type === 'CANCEL_TRADE_REQUEST' ||
      command.type === 'DECLARE_BANKRUPTCY'
    )
      await this.broadcast({ type: 'TRADE_REQUESTS_UPDATED', stateVersion });
    // A bankrupt leading bidder withdraws the bid, which changes the running auction.
    if (command.type === 'DECLARE_BANKRUPTCY') {
      const deadline = await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY);
      if (deadline !== undefined)
        await this.broadcast({
          type: 'AUCTION_UPDATED',
          stateVersion,
          auction: await this.auctions().getCurrent(deadline.gameId),
        });
    }
  }

  private async state(
    gameId: string,
    userId: string,
    details?: GameDetails,
  ): Promise<LiveGameState> {
    await this.settleQuietly(gameId);
    const controlledWallets = await this.access().controlledWallets(gameId, userId);
    const loaded = details ?? (await this.gameService().getGame(gameId));
    // A running auction without a remembered deadline (lost storage, a crash between the D1 write
    // and the storage write) is picked up again here, so it can never be stuck.
    if (
      loaded.auction?.state === 'ACTIVE' &&
      (await this.ctx.storage.get<AuctionDeadline>(AUCTION_DEADLINE_KEY)) === undefined
    )
      await this.armAuction(gameId, loaded.auction);
    return {
      stateVersion: await this.stateVersion(),
      details: {
        ...loaded,
        controlledWallets,
        controlledPlayerIds: controlledWallets.map((wallet) => wallet.playerId),
        ...(loaded.game.settings?.board == null
          ? {}
          : {
              tradeRequests: await new D1TradeRequestRepository(
                this.env.MONOPOLY_BANK_DB,
              ).listPendingForPlayers(
                gameId,
                controlledWallets.map((wallet) => wallet.playerId),
              ),
            }),
      },
      transactions: await this.transactions().listByGameId(gameId, 50),
    };
  }
  private async broadcastPresence(): Promise<void> {
    await this.broadcast({
      type: 'PRESENCE_UPDATED',
      stateVersion: await this.stateVersion(),
      connectedActors: this.connectedActors(),
    });
  }
  private connectedActors(): number {
    return new Set(
      this.ctx
        .getWebSockets()
        .map((ws) => {
          const attachment = ws.deserializeAttachment() as { userId?: unknown } | null;
          return typeof attachment?.userId === 'string' ? attachment.userId : null;
        })
        .filter((id): id is string => id !== null),
    ).size;
  }
  private send(ws: WebSocket, event: LiveServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      try {
        ws.close(1011, 'Socket delivery failed.');
      } catch {
        /* already broken */
      }
    }
  }
  private broadcast(event: LiveServerEvent): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, event);
    return Promise.resolve();
  }
  private async stateVersion(): Promise<number> {
    return (
      (await this.ctx.storage.get<number>('stateVersion')) ??
      (await this.ctx.storage.get<number>('version')) ??
      0
    );
  }
  private async incrementStateVersion(): Promise<number> {
    const value = (await this.stateVersion()) + 1;
    await this.ctx.storage.put('stateVersion', value);
    return value;
  }
  private transactions() {
    return new D1TransactionRepository(this.env.MONOPOLY_BANK_DB);
  }
  private commandLedger(): CommandLedgerRepository {
    return new D1CommandLedgerRepository(this.env.MONOPOLY_BANK_DB);
  }
  private gameService() {
    const database = this.env.MONOPOLY_BANK_DB;
    return new DefaultGameService({
      games: new D1GameRepository(database),
      players: new D1PlayerRepository(database),
      mortgages: new D1MortgageRepository(database),
      loans: new D1LoanRepository(database),
      transactions: new D1TransactionRepository(database),
      auctions: new D1AuctionRepository(database),
      properties: new D1PropertyRepository(database),
      createId: () => crypto.randomUUID(),
    });
  }
  private auctions() {
    const database = this.env.MONOPOLY_BANK_DB;
    return new DefaultAuctionService({
      games: new D1GameRepository(database),
      players: new D1PlayerRepository(database),
      transactions: new D1TransactionRepository(database),
      operations: new D1BankingOperationRepository(database),
      paymentRequests: new D1PaymentRequestRepository(database),
      auctions: new D1AuctionRepository(database),
      properties: new D1PropertyRepository(database),
    });
  }
  private access() {
    return new GameAccessService(new D1GameAccessRepository(this.env.MONOPOLY_BANK_DB));
  }
  private banking(commandId: string) {
    const database = this.env.MONOPOLY_BANK_DB;
    return new DefaultBankingService({
      games: new D1GameRepository(database),
      players: new D1PlayerRepository(database),
      transactions: new D1TransactionRepository(database),
      operations: new D1BankingOperationRepository(database),
      paymentRequests: new D1PaymentRequestRepository(database),
      tradeRequests: new D1TradeRequestRepository(database),
      mortgages: new D1MortgageRepository(database),
      loans: new D1LoanRepository(database),
      auctions: new D1AuctionRepository(database),
      properties: new D1PropertyRepository(database),
      createId: () => commandId,
    });
  }
  private async finishGame(
    gameId: string,
    winnerPlayerIds: readonly string[],
  ): Promise<GameDetails> {
    const beforeFinish = await this.gameService().getGame(gameId);
    if (winnerPlayerIds.some((id) => !beforeFinish.players.some((player) => player.id === id)))
      throw new ValidationError('winnerPlayerIds must belong to this game.');
    const winnerIds = new Set(winnerPlayerIds);
    const statistics = new D1GameStatisticsRepository(this.env.MONOPOLY_BANK_DB);
    await statistics.saveFinalSnapshot(
      gameId,
      winnerPlayerIds,
      await statistics.calculate(beforeFinish.game, beforeFinish.players),
    );
    const details = await this.gameService().finishGame(gameId);
    const participants = (await this.access().linkedMembers(gameId))
      .filter((member) => member.playerId !== null)
      .map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) }));
    await new ProfileStatisticsService(
      new D1GameCompletionRepository(this.env.MONOPOLY_BANK_DB),
    ).recordCompletedGame(gameId, participants);
    return details;
  }
}

type CommandOf<T extends LiveMutationCommand['type']> = Extract<LiveMutationCommand, { type: T }>;

type Executors = {
  [T in LiveMutationCommand['type']]: (
    gameId: string,
    userId: string,
    command: CommandOf<T>,
  ) => Promise<ResponsePayload>;
};

type Authorizers = {
  [T in LiveMutationCommand['type']]: (
    gameId: string,
    userId: string,
    command: CommandOf<T>,
  ) => Promise<void>;
};

interface ResponsePayload {
  status: number;
  data: unknown;
}
function forbidden(requestId: string): Response {
  return Response.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: 'You are not allowed to perform this operation.',
        requestId,
      },
    },
    { status: 403, headers: { 'x-request-id': requestId } },
  );
}
function context(request: Request, gameId: string, userId: string) {
  return {
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
    method: request.method,
    path: '/mutation',
    gameId,
    userId,
  };
}
function tryJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
function isHeartbeat(value: unknown): value is { type: 'HEARTBEAT' } {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'HEARTBEAT' &&
    Object.keys(value).length === 1
  );
}
async function commandPayloadHash(command: LiveMutationCommand): Promise<string> {
  const payload: Record<string, unknown> = { ...command };
  delete payload.commandId;
  const encoded = new TextEncoder().encode(canonicalJson(payload));
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
function replay(entry: CommandLedgerEntry): ResponsePayload {
  if (entry.resultStatus === null || entry.resultJson === null)
    throw new ValidationError('Completed command has no result.');
  return { status: entry.resultStatus, data: JSON.parse(entry.resultJson) as unknown };
}
function transactionIdFor(data: unknown): string | null {
  if (data !== null && typeof data === 'object' && 'transaction' in data) {
    const transaction = (data as { transaction?: unknown }).transaction;
    if (
      transaction !== null &&
      typeof transaction === 'object' &&
      typeof (transaction as { id?: unknown }).id === 'string'
    )
      return (transaction as { id: string }).id;
  }
  return null;
}
