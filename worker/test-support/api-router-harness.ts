import { vi, type Mock } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api.js';
import { buildGameDetails, buildPlayer, testUuid } from '../../shared/test-support/fixtures.js';
import { jsonRequest } from '../../shared/test-support/requests.js';
import { createApiRouter, type ApiRouterDependencies } from '../routes/api-router.js';

export const G = testUuid(0x01);
export const P1 = testUuid(0x02);
export const P2 = testUuid(0x03);
export const R = testUuid(0xa1);
export const T = testUuid(0xb1);
export const CMD = testUuid(0xc1);
export const USER = {
  id: testUuid(0x99),
  nickname: 'Test',
  avatar: '🧩',
  gamesPlayed: 0,
  gamesWon: 0,
  winRate: 0,
  createdAt: '',
  updatedAt: '',
};

export const details = (patch: Partial<GameDetails['game']> = {}): GameDetails =>
  buildGameDetails({
    game: { id: G, name: 'Table', ...patch },
    players: [
      buildPlayer({ id: P1, gameId: G, name: 'Ada', color: '#e05263' }),
      buildPlayer({ id: P2, gameId: G, name: 'Lin', color: '#2f80ed' }),
    ],
  });

type Fn = Mock<(...args: unknown[]) => unknown>;
const fns = (...names: string[]): Record<string, Fn> =>
  Object.fromEntries(names.map((name) => [name, vi.fn(async () => ({ name }))]));

export function harness(options: { live?: boolean; statistics?: boolean; dice?: boolean } = {}) {
  const live = options.live ?? false;
  const m = {
    games: fns(
      'listGamesForUser',
      'createGameForOwner',
      'getGame',
      'deleteGame',
      'listDeletedGamesForUser',
      'restoreGame',
      'regenerateJoinCode',
      'duplicateGameForOwner',
      'startGame',
      'finishGame',
      'toggleFavoriteAmount',
    ),
    banking: fns(
      'createTransaction',
      'listTransactions',
      'listPlayerTransactions',
      'getTransaction',
      'declareBankruptcy',
      'listPaymentRequests',
      'getPaymentRequest',
      'acceptPaymentRequest',
      'declinePaymentRequest',
      'cancelPaymentRequest',
      'listTradeRequests',
      'getTradeRequest',
      'createTradeRequest',
      'acceptTradeRequest',
      'declineTradeRequest',
      'cancelTradeRequest',
    ),
    auth: fns(
      'register',
      'login',
      'verifyEmail',
      'requestPasswordReset',
      'resetPassword',
      'logout',
      'revokeAll',
      'upgradeGuest',
      'addEmailToLegacyAccount',
      'resendVerification',
      'update',
      'exportAccount',
      'deleteAccount',
      'createGuest',
    ),
    access: fns(
      'requireOwner',
      'requirePlayerController',
      'requireReversalAuthority',
      'ownerJoinCode',
      'hasAccessPassword',
      'createInvitation',
      'revokeInvitations',
      'removeLobbyPlayer',
      'joinLobby',
      'requireLobbySeat',
      'linkedMembers',
      'invitation',
      'getJoinCredentials',
      'verifyGamePassword',
    ),
    statistics: fns('getFinalSnapshot', 'calculate', 'saveFinalSnapshot', 'pending', 'activity'),
    diceRolls: fns('list', 'record'),
    live: fns('mutate', 'connect', 'readAuction', 'readVersion', 'listDiceRolls', 'recordDiceRoll'),
    profileStatistics: fns('recordCompletedGame'),
    metrics: fns('record'),
  };
  const current = vi.fn(
    async (_request: Request, _id: string, _renewed?: (cookie: string) => void) => USER,
  );
  const requireMember = vi.fn(async () => 'PLAYER' as 'PLAYER' | 'OWNER');
  const controlledWallets = vi.fn(async () => [{ playerId: P1 }, { playerId: P2 }]);
  m.auth.current = current as unknown as Fn;
  m.access.requireMember = requireMember as unknown as Fn;
  m.access.controlledWallets = controlledWallets as unknown as Fn;
  m.games.getGame.mockResolvedValue(details());
  m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'LOBBY' });
  m.access.verifyGamePassword.mockResolvedValue(true);
  m.access.invitation.mockResolvedValue({ gameId: G, status: 'LOBBY' });
  m.auth.createGuest.mockResolvedValue({ profile: USER, cookie: 'guest=1' });
  m.auth.register.mockResolvedValue({ profile: USER, cookie: 'session=reg' });
  m.auth.login.mockResolvedValue({ profile: USER, cookie: 'session=login' });
  m.auth.upgradeGuest.mockResolvedValue({ profile: USER, cookie: 'session=up' });
  m.auth.logout.mockResolvedValue('session=; Max-Age=0');
  m.auth.revokeAll.mockResolvedValue('session=; Max-Age=0');
  m.auth.deleteAccount.mockResolvedValue('session=; Max-Age=0');
  m.live.mutate.mockImplementation(async () => Response.json({ data: { live: 'mutated' } }));
  m.live.connect.mockImplementation(async () => Response.json({ data: { live: 'connected' } }));
  m.live.readAuction.mockImplementation(async () => Response.json({ data: { live: 'auction' } }));
  m.live.readVersion.mockImplementation(async () => Response.json({ data: { stateVersion: 3 } }));
  m.live.listDiceRolls.mockImplementation(async () => Response.json({ data: [{ id: 'live' }] }));
  m.live.recordDiceRoll.mockImplementation(async () =>
    Response.json({ data: { id: 'live' } }, { status: 201 }),
  );
  const wiring = {
    games: m.games,
    banking: m.banking,
    auth: m.auth,
    access: m.access,
    profileStatistics: m.profileStatistics,
    metrics: m.metrics,
    ...(live ? { live: m.live } : {}),
    ...(options.statistics === false ? {} : { statistics: m.statistics }),
    ...(options.dice === false ? {} : { diceRolls: m.diceRolls }),
  };
  const router = createApiRouter(wiring as unknown as ApiRouterDependencies);
  return { router, m, requireMember };
}

export const request = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request => jsonRequest(method, path, body, headers, 'https://bank.example.test');

export interface Envelope {
  data?: unknown;
  error?: { code: string; message: string; requestId?: string };
}
export const read = async (response: Response): Promise<Envelope> =>
  (await response.json()) as Envelope;
export const withCommand = { 'x-command-id': CMD };
