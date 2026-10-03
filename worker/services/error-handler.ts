import type { ApiError } from '../../shared/contracts/api.js';
import { AppError, InternalError } from './errors.js';
export interface ErrorContext {
  requestId: string;
  method: string;
  path: string;
  userId?: string;
  gameId?: string;
  playerId?: string;
  cloudflareRayId?: string | null;
}
const sensitive = /password|token|authorization|cookie|secret|api[-_]?key|comment/i;
const tokenInUrl = /([?#&](?:token|invite)=)[^&#\s]+/giu;
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return value.replace(tokenInUrl, '$1[redacted]');
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitive.test(key) ? '[redacted]' : sanitize(item, depth + 1),
      ]),
    );
  return value;
}
export function serializeError(error: unknown, seen = new Set<unknown>()): Record<string, unknown> {
  if (seen.has(error)) return { message: '[circular cause]' };
  seen.add(error);
  if (error instanceof Error) {
    const app = error instanceof AppError ? { code: error.code, status: error.status } : {};
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
    return sanitize({
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...app,
      ...(cause === undefined ? {} : { cause: serializeError(cause, seen) }),
    }) as Record<string, unknown>;
  }
  return { name: typeof error, value: sanitize(error) };
}
export function logError(event: string, context: ErrorContext, error: unknown): void {
  console.error(
    JSON.stringify({ level: 'error', event, ...context, error: serializeError(error) }),
  );
}
export function handleError(error: unknown, context: ErrorContext): Response {
  const appError = error instanceof AppError ? error : new InternalError(error);
  const payload = {
    level: appError.status >= 500 ? 'error' : 'warn',
    event: 'request.failed',
    ...context,
    error: serializeError(error),
  };
  if (appError.status >= 500) console.error(JSON.stringify(payload));
  else console.warn(JSON.stringify(payload));
  const safe = appError.expose && appError.status < 500 ? appError : new InternalError();
  const body: ApiError = {
    error: {
      code: safe.code,
      message: safe.message,
      requestId: context.requestId,
      ...(safe.details === undefined
        ? {}
        : { details: sanitize(safe.details) as Record<string, string | number> }),
    },
  };
  return Response.json(body, {
    status: safe.status,
    headers: { 'x-request-id': context.requestId },
  });
}
