import type { GameDetails } from '../shared/contracts/api.js';
import { isLiveMutationCommand, type LiveGameState, type LiveMutationCommand, type LiveServerEvent } from '../shared/contracts/live.js';
import { controlledPlayerIdForBankingCommand } from '../shared/domain/player-control.js';
import { D1BankingOperationRepository } from './repositories/banking-operation-repository.js';
import { D1CommandLedgerRepository, type CommandLedgerRepository } from './repositories/command-ledger-repository.js';
import { D1GameAccessRepository } from './repositories/game-access-repository.js';
import { D1GameCompletionRepository } from './repositories/game-completion-repository.js';
import { D1GameRepository } from './repositories/game-repository.js';
import { D1GameStatisticsRepository } from './repositories/game-statistics-repository.js';
import { D1PaymentRequestRepository } from './repositories/payment-request-repository.js';
import { D1PlayerRepository } from './repositories/player-repository.js';
import { D1TransactionRepository } from './repositories/transaction-repository.js';
import { DefaultBankingService } from './services/banking-service.js';
import { ConflictError, ValidationError } from './services/errors.js';
import { handleError } from './services/error-handler.js';
import { GameAccessService } from './services/game-access-service.js';
import { DefaultGameService } from './services/game-service.js';
import { ProfileStatisticsService } from './services/profile-statistics-service.js';

/** One coordinator per game. All state-changing game commands enter here. */
export class GameSession {
  private readonly inFlightCommands = new Map<string, { actorId: string; payloadHash: string; response: Promise<ResponsePayload> }>();
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  constructor(ctx: DurableObjectState, env: Env) { this.ctx = ctx; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const gameId = request.headers.get('x-game-id');
    const userId = request.headers.get('x-user-id');
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    if (gameId === null || userId === null) return forbidden(requestId);
    const path = new URL(request.url).pathname;
    if (path === '/connect') return this.acceptConnection(gameId, userId, request);
    if (path === '/mutation') return this.mutate(gameId, userId, request);
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId } }, { status: 404, headers: { 'x-request-id': requestId } });
  }

  private async acceptConnection(gameId: string, userId: string, request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'WebSocket upgrade required.', requestId } }, { status: 426, headers: { 'x-request-id': requestId } });
    const details = await this.gameService().getGame(gameId);
    if (details.game.status === 'FINISHED') return Response.json({ error: { code: 'GAME_FINISHED', message: 'This game is finished.', requestId } }, { status: 409, headers: { 'x-request-id': requestId } });
    await this.access().requireMember(gameId, userId);
    const pair = new WebSocketPair();
    const client = pair[0]; const server = pair[1];
    server.serializeAttachment({ userId });
    this.ctx.acceptWebSocket(server, [userId]);
    this.send(server, { type: 'GAME_SNAPSHOT', state: await this.state(gameId, userId, details) });
    await this.broadcastPresence();
    return new Response(null, { status: 101, headers: { 'x-request-id': requestId }, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') { ws.close(1008, 'Invalid live protocol message.'); return; }
    const payload: unknown = tryJson(message);
    if (!isHeartbeat(payload)) { ws.close(1008, 'Commands must use the authenticated API.'); return; }
    this.send(ws, { type: 'HEARTBEAT', stateVersion: await this.stateVersion() });
  }

  async webSocketClose(): Promise<void> { await this.broadcastPresence(); }

  private async mutate(gameId: string, userId: string, request: Request): Promise<Response> {
    const command: unknown = await request.json().catch(() => null);
    if (!isLiveMutationCommand(command)) return handleError(new ValidationError('Invalid live mutation command.'), context(request, gameId, userId));
    try {
      const payloadHash = await commandPayloadHash(command);
      const existing = this.inFlightCommands.get(command.commandId);
      if (existing !== undefined && (existing.actorId !== userId || existing.payloadHash !== payloadHash)) throw new ConflictError('COMMAND_ID_REUSED', 'This command ID belongs to a different command.');
      const response = await (existing?.response ?? this.startCommand(gameId, userId, command, payloadHash));
      return Response.json({ data: response.data }, { status: response.status, headers: { 'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID() } });
    } catch (error) { return handleError(error, context(request, gameId, userId)); }
  }

  private startCommand(gameId: string, userId: string, command: LiveMutationCommand, payloadHash: string): Promise<ResponsePayload> {
    const pending = (async () => {
      const ledger = this.commandLedger();
      const entry = await ledger.claim({ gameId, commandId: command.commandId, actorId: userId, commandType: command.type, payloadHash });
      if (entry.status === 'COMPLETED') return replay(entry);
      await this.authorizeMutation(gameId, userId, command);
      const response = await this.execute(gameId, userId, command);
      await this.afterCommit('executed');
      const stateVersion = await this.incrementStateVersion();
      await this.afterCommit('version-incremented');
      await ledger.complete({ gameId, commandId: command.commandId, status: response.status, result: response.data, transactionId: transactionIdFor(response.data) });
      await this.afterCommit('ledger-completed');
      await this.publish(command, response.data, stateVersion);
      await this.afterCommit('published');
      return response;
    })();
    this.inFlightCommands.set(command.commandId, { actorId: userId, payloadHash, response: pending });
    void pending.finally(() => { if (this.inFlightCommands.get(command.commandId)?.response === pending) this.inFlightCommands.delete(command.commandId); }).catch(() => undefined);
    return pending;
  }

  private async execute(gameId: string, userId: string, command: LiveMutationCommand): Promise<ResponsePayload> {
    if (command.type === 'START_GAME') return { status: 200, data: await this.gameService().startGame(gameId) };
    if (command.type === 'JOIN_LOBBY') {
      await this.access().joinLobby({ gameId, userId, playerId: command.playerId, nickname: command.nickname, color: command.color, startingBalance: command.startingBalance });
      return { status: 201, data: await this.gameService().getGame(gameId) };
    }
    const banking = this.banking(command.commandId);
    if (command.type === 'CREATE_TRANSACTION') return { status: 201, data: await banking.createTransaction(gameId, command.request) };
    if (command.type === 'ACCEPT_PAYMENT_REQUEST') return { status: 200, data: await banking.acceptPaymentRequest(gameId, command.paymentRequestId) };
    if (command.type === 'DECLINE_PAYMENT_REQUEST') return { status: 200, data: await banking.declinePaymentRequest(gameId, command.paymentRequestId) };
    if (command.type === 'CANCEL_PAYMENT_REQUEST') return { status: 200, data: await banking.cancelPaymentRequest(gameId, command.paymentRequestId) };
    if (command.type === 'DECLARE_BANKRUPTCY') return { status: 201, data: await banking.declareBankruptcy(gameId, command.request) };
    return { status: 200, data: await this.finishGame(gameId, command.winnerPlayerIds) };
  }

  /** Test seam for failures after a durable financial commit; production is a no-op. */
  private async afterCommit(stage: 'executed' | 'ledger-completed' | 'version-incremented' | 'published'): Promise<void> { void stage; }

  private async authorizeMutation(gameId: string, userId: string, command: LiveMutationCommand): Promise<void> {
    const access = this.access();
    if (command.type === 'START_GAME' || command.type === 'FINISH_GAME') return access.requireOwner(gameId, userId);
    if (command.type === 'JOIN_LOBBY') {
      const details = await this.gameService().getGame(gameId);
      if (details.game.status !== 'LOBBY') throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
      return;
    }
    if (command.type === 'ACCEPT_PAYMENT_REQUEST' || command.type === 'DECLINE_PAYMENT_REQUEST') {
      const paymentRequest = await this.banking(command.commandId).getPaymentRequest(gameId, command.paymentRequestId);
      if (paymentRequest === null) throw new ValidationError('Payment request not found.');
      return access.requirePlayerController(gameId, userId, paymentRequest.approverPlayerId);
    }
    if (command.type === 'CANCEL_PAYMENT_REQUEST') {
      const paymentRequest = await this.banking(command.commandId).getPaymentRequest(gameId, command.paymentRequestId);
      if (paymentRequest === null) throw new ValidationError('Payment request not found.');
      return access.requirePlayerController(gameId, userId, paymentRequest.creatorPlayerId);
    }
    await access.requireMember(gameId, userId);
    await access.requirePlayerController(gameId, userId, controlledPlayerIdForBankingCommand(command.request));
  }

  private async publish(command: LiveMutationCommand, data: unknown, stateVersion: number): Promise<void> {
    if (command.type === 'START_GAME' || command.type === 'JOIN_LOBBY') {
      const details = data as GameDetails;
      await this.broadcast({ type: 'LOBBY_UPDATED', stateVersion, details: { game: details.game, players: details.players } });
      return;
    }
    if (command.type === 'FINISH_GAME') { await this.broadcast({ type: 'GAME_FINISHED', stateVersion, details: data as GameDetails }); return; }
    if (command.type === 'CREATE_TRANSACTION' && 'paymentRequests' in (data as object)) { await this.broadcast({ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion }); return; }
    const result = data as { transaction?: import('../shared/types/monopoly.js').Transaction; players?: import('../shared/types/monopoly.js').Player[] };
    if (result.transaction !== undefined && result.players !== undefined) await this.broadcast({ type: 'GAME_COMMITTED', stateVersion, transaction: result.transaction, players: result.players, ...(command.type === 'DECLARE_BANKRUPTCY' ? { bankruptPlayerId: command.request.playerId } : {}) });
    if (command.type === 'ACCEPT_PAYMENT_REQUEST' || command.type === 'DECLINE_PAYMENT_REQUEST' || command.type === 'CANCEL_PAYMENT_REQUEST') await this.broadcast({ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion });
  }

  private async state(gameId: string, userId: string, details?: GameDetails): Promise<LiveGameState> {
    const controlledWallets = await this.access().controlledWallets(gameId, userId);
    return { stateVersion: await this.stateVersion(), details: { ...(details ?? await this.gameService().getGame(gameId)), controlledWallets, controlledPlayerIds: controlledWallets.map((wallet) => wallet.playerId) }, transactions: await this.transactions().listByGameId(gameId, 50) };
  }
  private async broadcastPresence(): Promise<void> { await this.broadcast({ type: 'PRESENCE_UPDATED', stateVersion: await this.stateVersion(), connectedActors: this.connectedActors() }); }
  private connectedActors(): number { return new Set(this.ctx.getWebSockets().map((ws) => { const attachment = ws.deserializeAttachment() as { userId?: unknown } | null; return typeof attachment?.userId === 'string' ? attachment.userId : null; }).filter((id): id is string => id !== null)).size; }
  private send(ws: WebSocket, event: LiveServerEvent): void { try { ws.send(JSON.stringify(event)); } catch { try { ws.close(1011, 'Socket delivery failed.'); } catch { /* already broken */ } } }
  private async broadcast(event: LiveServerEvent): Promise<void> { for (const ws of this.ctx.getWebSockets()) this.send(ws, event); }
  private async stateVersion(): Promise<number> { return (await this.ctx.storage.get<number>('stateVersion')) ?? (await this.ctx.storage.get<number>('version')) ?? 0; }
  private async incrementStateVersion(): Promise<number> { const value = (await this.stateVersion()) + 1; await this.ctx.storage.put('stateVersion', value); return value; }
  private transactions() { return new D1TransactionRepository(this.env.MONOPOLY_BANK_DB); }
  private commandLedger(): CommandLedgerRepository { return new D1CommandLedgerRepository(this.env.MONOPOLY_BANK_DB); }
  private gameService() { const database = this.env.MONOPOLY_BANK_DB; return new DefaultGameService({ games: new D1GameRepository(database), players: new D1PlayerRepository(database), createId: () => crypto.randomUUID() }); }
  private access() { return new GameAccessService(new D1GameAccessRepository(this.env.MONOPOLY_BANK_DB)); }
  private banking(commandId: string) { const database = this.env.MONOPOLY_BANK_DB; return new DefaultBankingService({ games: new D1GameRepository(database), players: new D1PlayerRepository(database), transactions: new D1TransactionRepository(database), operations: new D1BankingOperationRepository(database), paymentRequests: new D1PaymentRequestRepository(database), createId: () => commandId }); }
  private async finishGame(gameId: string, winnerPlayerIds: readonly string[]): Promise<GameDetails> {
    const beforeFinish = await this.gameService().getGame(gameId);
    if (winnerPlayerIds.some((id) => !beforeFinish.players.some((player) => player.id === id))) throw new ValidationError('winnerPlayerIds must belong to this game.');
    const winnerIds = new Set(winnerPlayerIds); const statistics = new D1GameStatisticsRepository(this.env.MONOPOLY_BANK_DB);
    await statistics.saveFinalSnapshot(gameId, winnerPlayerIds, await statistics.calculate(beforeFinish.game, beforeFinish.players));
    const details = await this.gameService().finishGame(gameId);
    const participants = (await this.access().linkedMembers(gameId)).filter((member) => member.playerId !== null).map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) }));
    await new ProfileStatisticsService(new D1GameCompletionRepository(this.env.MONOPOLY_BANK_DB)).recordCompletedGame(gameId, participants);
    return details;
  }
}

interface ResponsePayload { status: number; data: unknown; }
function forbidden(requestId: string): Response { return Response.json({ error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this operation.', requestId } }, { status: 403, headers: { 'x-request-id': requestId } }); }
function context(request: Request, gameId: string, userId: string) { return { requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(), method: request.method, path: '/mutation', gameId, userId }; }
function tryJson(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return null; } }
function isHeartbeat(value: unknown): value is { type: 'HEARTBEAT' } { return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'HEARTBEAT' && Object.keys(value).length === 1; }
async function commandPayloadHash(command: LiveMutationCommand): Promise<string> { const payload: Record<string, unknown> = { ...command }; delete payload.commandId; const encoded = new TextEncoder().encode(canonicalJson(payload)); const hash = await crypto.subtle.digest('SHA-256', encoded); return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`; }
function replay(entry: import('./repositories/command-ledger-repository.js').CommandLedgerEntry): ResponsePayload { if (entry.resultStatus === null || entry.resultJson === null) throw new ValidationError('Completed command has no result.'); return { status: entry.resultStatus, data: JSON.parse(entry.resultJson) as unknown }; }
function transactionIdFor(data: unknown): string | null { if (data !== null && typeof data === 'object' && 'transaction' in data) { const transaction = (data as { transaction?: unknown }).transaction; if (transaction !== null && typeof transaction === 'object' && typeof (transaction as { id?: unknown }).id === 'string') return (transaction as { id: string }).id; } return null; }
