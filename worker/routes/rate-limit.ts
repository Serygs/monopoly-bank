import { RateLimitError } from '../services/errors.js';
import { tokenHash } from '../services/password-security.js';
import { securityEvent } from '../services/security-events.js';
import type { SecurityRateLimitRepository } from '../repositories/security-rate-limit-repository.js';
import { normalizeJoinCode, parseLoginRequest } from '../validation/api-validation.js';

interface RateLimitRule {
  category: string;
  limit: number;
  seconds: number;
  matches: (pathname: string, method: string) => boolean;
}

const RATE_LIMIT_RULES: readonly RateLimitRule[] = [
  {
    category: 'register',
    limit: 10,
    seconds: 600,
    matches: (pathname) => pathname === '/api/auth/register',
  },
  {
    category: 'email',
    limit: 5,
    seconds: 3600,
    matches: (pathname) =>
      pathname === '/api/auth/password-reset' || pathname === '/api/auth/verification-email',
  },
  {
    category: 'guest-join',
    limit: 12,
    seconds: 600,
    matches: (pathname) => pathname === '/api/games/join/guest',
  },
  {
    category: 'join',
    limit: 30,
    seconds: 600,
    matches: (pathname, method) => pathname === '/api/games/join' && method === 'POST',
  },
  {
    category: 'invite',
    limit: 12,
    seconds: 3600,
    matches: (pathname, method) =>
      /^\/api\/games\/[^/]+\/invitations$/.test(pathname) && method === 'POST',
  },
];

// Failed join attempts (unknown code or wrong password, indistinguishable) are counted, never the
// successful ones. A pair is locked after a few failures, so guessing one code from one source is
// slow; the source-wide and per-code caps are high so one noisy source cannot lock a table out.
const JOIN_FAILURE_WINDOW_SECONDS = 15 * 60;
const JOIN_FAILURE_PAIR_LIMIT = 5;
const JOIN_FAILURE_SOURCE_LIMIT = 30;
const JOIN_FAILURE_CODE_LIMIT = 300;

interface JoinFailureKeys {
  pair: string;
  source: string;
  code: string;
}

function requestSource(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function rateLimited(requestId: string): RateLimitError {
  securityEvent('rate_limited', { requestId });
  return new RateLimitError();
}

export async function enforceRateLimit(
  request: Request,
  repository: SecurityRateLimitRepository | undefined,
  requestId: string,
): Promise<void> {
  if (repository === undefined) return;
  const pathname = new URL(request.url).pathname;
  const source = requestSource(request);
  if (pathname === '/api/auth/login' && request.method === 'POST')
    return enforceLoginLimit(request, repository, source, requestId);
  const rule = RATE_LIMIT_RULES.find((candidate) => candidate.matches(pathname, request.method));
  if (rule === undefined) return;
  const bucket = `${rule.category}:${await tokenHash(source)}`;
  if (!(await repository.take(bucket, rule.limit, rule.seconds))) throw rateLimited(requestId);
  if (rule.category !== 'join' && rule.category !== 'guest-join') return;
  const keys = await joinFailureKeys(request, source);
  if (keys !== null && (await joinLockedOut(repository, keys))) throw rateLimited(requestId);
}

async function enforceLoginLimit(
  request: Request,
  repository: SecurityRateLimitRepository,
  source: string,
  requestId: string,
): Promise<void> {
  // Bound source-wide work without sharing one player's small login allowance.
  const sourceHash = await tokenHash(source);
  if (!(await repository.take(`login-source:${sourceHash}`, 120, 600)))
    throw rateLimited(requestId);
  const input = await parseLoginRequest(request.clone());
  const identifier =
    'email' in input
      ? `email:${input.email.toLowerCase()}`
      : `nickname:${input.nickname.toLowerCase()}`;
  if (
    !(await repository.take(`login-account:${await tokenHash(identifier)}:${sourceHash}`, 10, 600))
  )
    throw rateLimited(requestId);
}

/** Buckets hold hashes only: never the code, nor the address. */
async function joinFailureKeys(request: Request, source: string): Promise<JoinFailureKeys | null> {
  let joinCode: unknown;
  try {
    joinCode = ((await request.clone().json()) as { joinCode?: unknown }).joinCode;
  } catch {
    return null;
  }
  if (typeof joinCode !== 'string') return null;
  return failureKeys(source, joinCode);
}

async function failureKeys(source: string, joinCode: string): Promise<JoinFailureKeys> {
  const code = await tokenHash(normalizeJoinCode(joinCode).slice(0, 64));
  const sourceHash = await tokenHash(source);
  return {
    pair: `join-fail-pair:${sourceHash}:${code}`,
    source: `join-fail-source:${sourceHash}`,
    code: `join-fail-code:${code}`,
  };
}

async function joinLockedOut(
  repository: SecurityRateLimitRepository,
  keys: JoinFailureKeys,
): Promise<boolean> {
  const window = JOIN_FAILURE_WINDOW_SECONDS;
  return (
    (await repository.isExceeded(keys.pair, JOIN_FAILURE_PAIR_LIMIT, window)) ||
    (await repository.isExceeded(keys.source, JOIN_FAILURE_SOURCE_LIMIT, window)) ||
    (await repository.isExceeded(keys.code, JOIN_FAILURE_CODE_LIMIT, window))
  );
}

export async function recordJoinFailure(
  repository: SecurityRateLimitRepository | undefined,
  request: Request,
  joinCode: string,
): Promise<void> {
  if (repository === undefined) return;
  const keys = await failureKeys(requestSource(request), joinCode);
  const window = JOIN_FAILURE_WINDOW_SECONDS;
  await repository.recordFailure(keys.pair, window);
  await repository.recordFailure(keys.source, window);
  await repository.recordFailure(keys.code, window);
}
