import { ConflictError } from '../services/errors.js';
import { securityEvent } from '../services/security-events.js';
import { requireSameOriginWebSocket } from '../services/request-security.js';
import { ApiValidationError, parseResourceId } from '../validation/api-validation.js';
import type { GameStatisticsRepository } from '../repositories/game-statistics-repository.js';
import {
  failure,
  liveUnavailable,
  readHistoryLimit,
  route,
  success,
  walletIds,
  type AuthedRouteContext,
  type Route,
} from './route-support.js';

function gameIdOf(context: AuthedRouteContext): string {
  return parseResourceId(context.params[0], 'gameId');
}

function requireStatistics(context: AuthedRouteContext): GameStatisticsRepository {
  const { statistics } = context.dependencies;
  if (statistics === undefined)
    throw new ConflictError('STATISTICS_UNAVAILABLE', 'Statistics are not configured.');
  return statistics;
}

async function connectLive(context: AuthedRouteContext): Promise<Response> {
  const { request, requestId, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  try {
    requireSameOriginWebSocket(request);
  } catch (error) {
    securityEvent('websocket_origin_rejected', { requestId, gameId });
    throw error;
  }
  await dependencies.access.requireMember(gameId, actor.id);
  const details = await dependencies.games.getGame(gameId);
  if (details.game.status === 'FINISHED')
    return failure(409, 'GAME_FINISHED', 'This game is finished.', requestId);
  return dependencies.live === undefined
    ? liveUnavailable(requestId)
    : dependencies.live.connect(gameId, actor, request);
}

async function readSummary(context: AuthedRouteContext): Promise<Response> {
  const { dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const details = await dependencies.games.getGame(gameId);
  const statistics = requireStatistics(context);
  const snapshot =
    details.game.status === 'FINISHED' ? await statistics.getFinalSnapshot(gameId) : null;
  const summary = snapshot?.summary ?? (await statistics.calculate(details.game, details.players));
  const playersById = new Map(details.players.map((player) => [player.id, player]));
  const winners = (snapshot?.winnerPlayerIds ?? [])
    .map((id) => playersById.get(id))
    .filter((player): player is (typeof details.players)[number] => player !== undefined);
  return success({ game: details.game, winners, ...summary });
}

function readActivityCursor(value: string | null): { createdAt: string; id: string } | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(String((parsed as { id?: unknown }).id))
    )
      throw new Error();
    return {
      createdAt: (parsed as { createdAt: string }).createdAt,
      id: String((parsed as { id: string }).id),
    };
  } catch {
    throw new ApiValidationError('cursor is invalid.');
  }
}

async function readActivity(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const statistics = requireStatistics(context);
  const query = new URL(request.url).searchParams;
  const scope = query.get('scope') ?? 'ALL';
  if (scope !== 'ALL' && scope !== 'MINE' && scope !== 'PENDING')
    throw new ApiValidationError('scope must be ALL, MINE, or PENDING.');
  const limit = readHistoryLimit(request);
  const cursor = readActivityCursor(query.get('cursor'));
  const playerIds = walletIds(await dependencies.access.controlledWallets(gameId, actor.id));
  return success(
    scope === 'PENDING'
      ? await statistics.pending(gameId, playerIds, cursor, limit)
      : await statistics.activity(gameId, scope, playerIds, cursor, limit),
  );
}

export const historyRoutes: Route<AuthedRouteContext>[] = [
  route('GET', /^\/api\/games\/([^/]+)\/live$/, connectLive),
  route('GET', /^\/api\/games\/([^/]+)\/summary$/, readSummary),
  route('GET', /^\/api\/games\/([^/]+)\/activity$/, readActivity),
];
