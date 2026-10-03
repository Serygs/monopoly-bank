export type SecurityEventCategory =
  'csrf_rejected' | 'websocket_origin_rejected' | 'rate_limited' | 'session_revoked';

/** Deliberately excludes user identity, IP, token, amount, and transaction comments. */
export function securityEvent(
  category: SecurityEventCategory,
  context: { requestId: string; gameId?: string },
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'security.event',
      category,
      requestId: context.requestId,
      ...(context.gameId === undefined ? {} : { gameId: context.gameId }),
    }),
  );
}
