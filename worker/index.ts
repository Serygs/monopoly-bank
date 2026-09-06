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
export { GameSession } from './game-session.js';

export default {
  fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 });
    }

    const games = new D1GameRepository(env.MONOPOLY_BANK_DB);
    const players = new D1PlayerRepository(env.MONOPOLY_BANK_DB);
    const transactions = new D1TransactionRepository(env.MONOPOLY_BANK_DB);
    const authEnv = env as Env & { RESEND_API_KEY: string; RESEND_FROM_EMAIL: string; APP_ORIGIN: string };
    const createId = () => crypto.randomUUID();
    const access = new GameAccessService(new D1GameAccessRepository(env.MONOPOLY_BANK_DB));
    const router = createApiRouter({
      games: new DefaultGameService({ games, players, createId }),
      auth: new AuthService(new D1UserRepository(env.MONOPOLY_BANK_DB), new D1SessionRepository(env.MONOPOLY_BANK_DB), new D1AuthTokenRepository(env.MONOPOLY_BANK_DB), new ResendTransactionalEmailProvider(authEnv.RESEND_API_KEY, authEnv.RESEND_FROM_EMAIL), createId, authEnv.APP_ORIGIN),
      access,
      profileStatistics: new ProfileStatisticsService(new D1GameCompletionRepository(env.MONOPOLY_BANK_DB)),
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
    });
    return router(request);
  },
} satisfies ExportedHandler<Env>;
