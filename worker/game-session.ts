import type { GameDetails } from '../shared/contracts/api.js';
import { isLiveMutationCommand, type LiveGameState, type LiveMutationCommand, type LiveServerEvent } from '../shared/contracts/live.js';
import { D1BankingOperationRepository } from './repositories/banking-operation-repository.js';
import { D1GameRepository } from './repositories/game-repository.js';
import { D1PlayerRepository } from './repositories/player-repository.js';
import { D1TransactionRepository } from './repositories/transaction-repository.js';
import { DefaultBankingService } from './services/banking-service.js';
import { DefaultGameService } from './services/game-service.js';
import { D1GameAccessRepository } from './repositories/game-access-repository.js';
import { D1GameCompletionRepository } from './repositories/game-completion-repository.js';
import { GameAccessService } from './services/game-access-service.js';
import { ProfileStatisticsService } from './services/profile-statistics-service.js';
import { calculateWinners } from '../shared/domain/winner-calculation.js';
import { BankingDomainError, InsufficientFundsError } from '../shared/domain/banking.js';

/** One instance per game: serializes writes and keeps hibernatable member sockets. */
export class GameSession {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  constructor(ctx: DurableObjectState, env: Env) { this.ctx = ctx; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const gameId = request.headers.get('x-game-id');
    const userId = request.headers.get('x-user-id');
    if (gameId === null || userId === null) return new Response('Forbidden', { status: 403 });
    if (new URL(request.url).pathname === '/connect') return this.acceptConnection(gameId, userId, request);
    if (new URL(request.url).pathname === '/mutation') return this.mutate(gameId, request);
    return new Response('Not found', { status: 404 });
  }

  private async acceptConnection(gameId: string, userId: string, request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    const details = await this.gameService().getGame(gameId);
    if (details.game.status !== 'ACTIVE') return new Response('Game is not active', { status: 409 });
    const pair = new WebSocketPair();
    const client = pair[0]; const server = pair[1];
    server.serializeAttachment({ userId });
    this.ctx.acceptWebSocket(server, [userId]);
    server.send(JSON.stringify({ type: 'GAME_STATE', state: await this.state(gameId, details) } satisfies LiveServerEvent));
    await this.broadcast({ type: 'MEMBER_JOINED', version: await this.version(), connectedMembers: this.ctx.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Financial commands travel through authenticated HTTP, preventing socket spoofing/replay.
    if (typeof message !== 'string' || message !== 'ping') ws.close(1008, 'Commands must use the authenticated API.');
  }

  async webSocketClose(): Promise<void> {
    await this.broadcast({ type: 'MEMBER_JOINED', version: await this.version(), connectedMembers: this.ctx.getWebSockets().length });
  }

  private async mutate(gameId: string, request: Request): Promise<Response> {
    const command: unknown = await request.json().catch(() => null);
    if (!isLiveMutationCommand(command)) return jsonError(400, 'VALIDATION_ERROR', 'Invalid live mutation command.');
    const replay = await this.ctx.storage.get<ResponsePayload>(`command:${command.commandId}`);
    if (replay !== undefined) return Response.json(replay, { status: replay.status });
    try {
      const response = await this.execute(gameId, command);
      const version = await this.incrementVersion();
      await this.ctx.storage.put(`command:${command.commandId}`, response);
      await this.publish(command, response.data, version);
      return Response.json(response, { status: response.status });
    } catch (error) { return mapError(error); }
  }

  private async execute(gameId: string, command: LiveMutationCommand): Promise<ResponsePayload> {
    const banking = this.banking(command.commandId);
    if (command.type === 'CREATE_TRANSACTION') return { status: 201, data: await banking.createTransaction(gameId, command.request) };
    if (command.type === 'DECLARE_BANKRUPTCY') return { status: 201, data: await banking.declareBankruptcy(gameId, command.request) };
    return { status: 200, data: await this.finishGame(gameId) };
  }

  private async publish(command: LiveMutationCommand, data: unknown, version: number): Promise<void> {
    if (command.type === 'FINISH_GAME') { await this.broadcast({ type: 'GAME_FINISHED', version, details: data as GameDetails }); return; }
    const result = data as { transaction: import('../shared/types/monopoly.js').Transaction; players: import('../shared/types/monopoly.js').Player[] };
    await this.broadcast({ type: 'TRANSACTION_CREATED', version, transaction: result.transaction });
    await this.broadcast({ type: 'BALANCES_UPDATED', version, players: result.players });
    if (command.type === 'DECLARE_BANKRUPTCY') await this.broadcast({ type: 'PLAYER_BANKRUPT', version, playerId: command.request.playerId, players: result.players });
  }

  private async state(gameId: string, details?: GameDetails): Promise<LiveGameState> {
    return { version: await this.version(), details: details ?? await this.gameService().getGame(gameId), transactions: await this.transactions().listByGameId(gameId, 100) };
  }
  private async broadcast(event: LiveServerEvent): Promise<void> { const encoded = JSON.stringify(event); for (const ws of this.ctx.getWebSockets()) ws.send(encoded); }
  private version(): Promise<number> { return this.ctx.storage.get<number>('version').then((value) => value ?? 0); }
  private async incrementVersion(): Promise<number> { const value = (await this.version()) + 1; await this.ctx.storage.put('version', value); return value; }
  private transactions() { return new D1TransactionRepository(this.env.MONOPOLY_BANK_DB); }
  private gameService() { const database = this.env.MONOPOLY_BANK_DB; return new DefaultGameService({ games: new D1GameRepository(database), players: new D1PlayerRepository(database), createId: () => crypto.randomUUID() }); }
  private banking(commandId: string) { const database = this.env.MONOPOLY_BANK_DB; return new DefaultBankingService({ games: new D1GameRepository(database), players: new D1PlayerRepository(database), transactions: new D1TransactionRepository(database), operations: new D1BankingOperationRepository(database), createId: () => commandId }); }
  private async finishGame(gameId: string): Promise<GameDetails> {
    const details = await this.gameService().finishGame(gameId);
    const winnerIds = new Set(calculateWinners(details.players).map((player) => player.id));
    const access = new GameAccessService(new D1GameAccessRepository(this.env.MONOPOLY_BANK_DB));
    const participants = (await access.linkedMembers(gameId)).filter((member) => member.playerId !== null).map((member) => ({ userId: member.userId, won: winnerIds.has(member.playerId as string) }));
    await new ProfileStatisticsService(new D1GameCompletionRepository(this.env.MONOPOLY_BANK_DB)).recordCompletedGame(gameId, participants);
    return details;
  }
}

interface ResponsePayload { status: number; data: unknown; }
function jsonError(status: number, code: string, message: string): Response { return Response.json({ error: { code, message } }, { status }); }
function mapError(error: unknown): Response {
  if (error instanceof InsufficientFundsError) return jsonError(409, error.code, 'Insufficient funds.');
  if (error instanceof BankingDomainError) return jsonError(400, error.code, 'The banking operation is invalid.');
  return jsonError(500, 'INTERNAL_ERROR', 'The operation could not be completed.');
}
