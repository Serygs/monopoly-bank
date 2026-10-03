import { createApiRouter } from './routes/api-router.js';
import { D1BankingOperationRepository } from './repositories/banking-operation-repository.js';
import { D1GameRepository } from './repositories/game-repository.js';
import { D1PlayerRepository } from './repositories/player-repository.js';
import { D1TransactionRepository } from './repositories/transaction-repository.js';
import { D1PaymentRequestRepository } from './repositories/payment-request-repository.js';
import { DefaultBankingService } from './services/banking-service.js';
import { DefaultGameService } from './services/game-service.js';
import { D1UserRepository } from './repositories/user-repository.js';
import { D1SessionRepository } from './repositories/session-repository.js';
import { D1AuthTokenRepository } from './repositories/auth-token-repository.js';
import { D1GameAccessRepository } from './repositories/game-access-repository.js';
import { AuthService } from './services/auth-service.js';
import { GameAccessService } from './services/game-access-service.js';
import { D1GameCompletionRepository } from './repositories/game-completion-repository.js';
import { ProfileStatisticsService } from './services/profile-statistics-service.js';
import { D1GameStatisticsRepository } from './repositories/game-statistics-repository.js';
import { DurableObjectGameLiveGateway } from './services/game-live-gateway.js';
import { ResendTransactionalEmailProvider } from './services/transactional-email.js';
import { D1SecurityRateLimitRepository } from './repositories/security-rate-limit-repository.js';
import { AnalyticsOperationalMetrics } from './services/operational-metrics.js';
import { D1PrivacyRepository } from './repositories/privacy-repository.js';
export { GameSession } from './game-session.js';

export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 });
    }

    const startedAt = Date.now();
    const metrics = new AnalyticsOperationalMetrics(env.OPERATIONAL_METRICS);
    const games = new D1GameRepository(env.MONOPOLY_BANK_DB);
    const players = new D1PlayerRepository(env.MONOPOLY_BANK_DB);
    const transactions = new D1TransactionRepository(env.MONOPOLY_BANK_DB);
    const authEnv = env as Env & {
      RESEND_API_KEY: string;
      RESEND_FROM_EMAIL: string;
      APP_ORIGIN: string;
    };
    const createId = () => crypto.randomUUID();
    const access = new GameAccessService(new D1GameAccessRepository(env.MONOPOLY_BANK_DB));
    const router = createApiRouter({
      games: new DefaultGameService({ games, players, createId }),
      auth: new AuthService(
        new D1UserRepository(env.MONOPOLY_BANK_DB),
        new D1SessionRepository(env.MONOPOLY_BANK_DB),
        new D1AuthTokenRepository(env.MONOPOLY_BANK_DB),
        new ResendTransactionalEmailProvider(
          authEnv.RESEND_API_KEY,
          authEnv.RESEND_FROM_EMAIL,
          fetch,
          metrics,
        ),
        createId,
        authEnv.APP_ORIGIN,
        new D1PrivacyRepository(env.MONOPOLY_BANK_DB),
      ),
      access,
      profileStatistics: new ProfileStatisticsService(
        new D1GameCompletionRepository(env.MONOPOLY_BANK_DB),
      ),
      statistics: new D1GameStatisticsRepository(env.MONOPOLY_BANK_DB),
      banking: new DefaultBankingService({
        games,
        players,
        transactions,
        operations: new D1BankingOperationRepository(env.MONOPOLY_BANK_DB),
        paymentRequests: new D1PaymentRequestRepository(env.MONOPOLY_BANK_DB),
        createId,
      }),
      live: new DurableObjectGameLiveGateway(env.GAME_SESSIONS),
      rateLimits: new D1SecurityRateLimitRepository(env.MONOPOLY_BANK_DB),
      metrics,
    });
    try {
      const response = await router(request);
      metrics.record(
        'api',
        apiOperation(request),
        response.ok ? 'success' : 'failure',
        Date.now() - startedAt,
        response.status,
      );
      return response;
    } catch (error) {
      metrics.record('api', apiOperation(request), 'unavailable', Date.now() - startedAt, 500);
      throw error;
    }
  },
  scheduled(_controller, env, ctx) {
    const authEnv = env as Env & {
      RESEND_API_KEY: string;
      RESEND_FROM_EMAIL: string;
      APP_ORIGIN: string;
    };
    const metrics = new AnalyticsOperationalMetrics(env.OPERATIONAL_METRICS);
    const privacy = new D1PrivacyRepository(env.MONOPOLY_BANK_DB);
    const auth = new AuthService(
      new D1UserRepository(env.MONOPOLY_BANK_DB),
      new D1SessionRepository(env.MONOPOLY_BANK_DB),
      new D1AuthTokenRepository(env.MONOPOLY_BANK_DB),
      new ResendTransactionalEmailProvider(
        authEnv.RESEND_API_KEY,
        authEnv.RESEND_FROM_EMAIL,
        fetch,
        metrics,
      ),
      () => crypto.randomUUID(),
      authEnv.APP_ORIGIN,
      privacy,
    );
    const rateLimits = new D1SecurityRateLimitRepository(env.MONOPOLY_BANK_DB);
    ctx.waitUntil(
      Promise.all([
        auth.cleanupExpired(),
        rateLimits.cleanup(),
        privacy.cleanupExpiredGuests(),
        privacy.cleanupExpiredOperationalData(),
      ])
        .then(() => metrics.record('cleanup', 'scheduled', 'success'))
        .catch(() => metrics.record('cleanup', 'scheduled', 'failure')),
    );
  },
} satisfies ExportedHandler<Env>;

function apiOperation(request: Request): string {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/auth/')) return 'auth';
  if (path.includes('/live')) return 'live';
  if (path.includes('/transactions') || path.includes('/payment-requests')) return 'banking';
  if (path.startsWith('/api/games')) return 'games';
  return 'other';
}
