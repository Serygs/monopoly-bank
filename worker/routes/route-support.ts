import type { ApiSuccess } from '../../shared/contracts/api.js';
import type { AuthService, PublicProfile } from '../services/auth-service.js';
import type { BankingService } from '../services/banking-service.js';
import type { DiceRollService } from '../services/dice-roll-service.js';
import type { GameAccessService } from '../services/game-access-service.js';
import type { GameLiveGateway } from '../services/game-live-gateway.js';
import type { GameService } from '../services/game-service.js';
import type { OperationalMetrics } from '../services/operational-metrics.js';
import type { ProfileStatisticsService } from '../services/profile-statistics-service.js';
import type { GameStatisticsRepository } from '../repositories/game-statistics-repository.js';
import type { SecurityRateLimitRepository } from '../repositories/security-rate-limit-repository.js';
import { ApiValidationError } from '../validation/api-validation.js';

export interface ApiRouterDependencies {
  games: GameService;
  banking: BankingService;
  auth: AuthService;
  access: GameAccessService;
  profileStatistics: ProfileStatisticsService;
  statistics?: GameStatisticsRepository;
  diceRolls?: DiceRollService;
  live?: GameLiveGateway;
  rateLimits?: SecurityRateLimitRepository;
  metrics?: OperationalMetrics;
}

export interface PublicRouteContext {
  request: Request;
  dependencies: ApiRouterDependencies;
  requestId: string;
  params: string[];
}

export interface AuthedRouteContext extends PublicRouteContext {
  actor: PublicProfile;
}

export interface Route<Context> {
  method: string | null;
  pattern: RegExp;
  handle: (context: Context) => Promise<Response>;
}

export function route<Context>(
  method: string | null,
  pattern: RegExp,
  handle: (context: Context) => Promise<Response>,
): Route<Context> {
  return { method, pattern, handle };
}

export function matchRoute<Context>(
  routes: readonly Route<Context>[],
  method: string,
  pathname: string,
): { route: Route<Context>; params: string[] } | null {
  for (const candidate of routes) {
    if (candidate.method !== null && candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (match !== null) return { route: candidate, params: match.slice(1) };
  }
  return null;
}

export function success<T>(data: T, status = 200, cookie?: string): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, {
    status,
    ...(cookie === undefined ? {} : { headers: { 'set-cookie': cookie } }),
  });
}

export function failure(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, string | number>,
): Response {
  return Response.json(
    { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

export function readCommandId(request: Request): string {
  const commandId = request.headers.get('x-command-id');
  if (
    commandId === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(commandId)
  )
    throw new ApiValidationError('x-command-id must be a UUID v4.');
  return commandId;
}

export function readLimit(request: Request, fallback: number): number {
  const value = new URL(request.url).searchParams.get('limit');
  if (value === null) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ApiValidationError('limit must be an integer between 1 and 100.');
  return limit;
}

export const readHistoryLimit = (request: Request): number => readLimit(request, 100);

export const readDiceHistoryLimit = (request: Request): number => readLimit(request, 20);

export function walletIds(wallets: readonly { playerId: string }[]): string[] {
  return wallets.map((wallet) => wallet.playerId);
}

export function liveUnavailable(requestId: string): Response {
  return failure(503, 'LIVE_UNAVAILABLE', 'Live games are not configured.', requestId);
}
