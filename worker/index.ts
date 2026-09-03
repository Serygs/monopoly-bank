import { createApiRouter } from './routes/api-router.js';
import { D1BankingOperationRepository } from './repositories/banking-operation-repository.js';
import { D1GameRepository } from './repositories/game-repository.js';
import { D1PlayerRepository } from './repositories/player-repository.js';
import { D1TransactionRepository } from './repositories/transaction-repository.js';
import { DefaultBankingService } from './services/banking-service.js';
import { DefaultGameService } from './services/game-service.js';

export default {
  fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 });
    }

    const games = new D1GameRepository(env.MONOPOLY_BANK_DB);
    const players = new D1PlayerRepository(env.MONOPOLY_BANK_DB);
    const transactions = new D1TransactionRepository(env.MONOPOLY_BANK_DB);
    const createId = () => crypto.randomUUID();
    const router = createApiRouter({
      games: new DefaultGameService({ games, players, createId }),
      banking: new DefaultBankingService({
        games,
        players,
        transactions,
        operations: new D1BankingOperationRepository(env.MONOPOLY_BANK_DB),
        createId,
      }),
    });
    return router(request);
  },
} satisfies ExportedHandler<Env>;
