export type SecurityEventCategory =
  | 'csrf_rejected'
  | 'websocket_origin_rejected'
  | 'rate_limited'
  | 'session_revoked'
  | 'session_rejected'
  | 'login_rejected';
export type SessionRejectionReason = 'missing_cookie' | 'expired_or_revoked' | 'account_missing';
export type LoginRejectionReason = 'account_missing' | 'guest_account' | 'password_mismatch';

/** Deliberately excludes user identity, IP, token, amount, and transaction comments. */
export function securityEvent(
  category: SecurityEventCategory,
  context: {
    requestId: string;
    gameId?: string;
    reason?: SessionRejectionReason | LoginRejectionReason;
  },
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'security.event',
      category,
      requestId: context.requestId,
      ...(context.gameId === undefined ? {} : { gameId: context.gameId }),
      ...(context.reason === undefined ? {} : { reason: context.reason }),
    }),
  );
}
