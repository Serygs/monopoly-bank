import { describe, expect, it } from 'vitest';
import { D1CommandLedgerRepository } from './command-ledger-repository.js';
import { ConflictError } from '../services/errors.js';

const input = {
  gameId: 'game',
  commandId: 'command',
  actorId: 'actor-a',
  commandType: 'CREATE_TRANSACTION',
  payloadHash: 'a'.repeat(64),
};

describe('D1CommandLedgerRepository', () => {
  it('replays only the identical actor and canonical payload', async () => {
    const repository = new D1CommandLedgerRepository(new LedgerDatabase() as unknown as D1Database);
    await repository.claim(input);
    await expect(repository.claim({ ...input, actorId: 'actor-b' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      repository.claim({ ...input, payloadHash: 'b'.repeat(64) }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

class LedgerDatabase {
  private row: Record<string, unknown> | null = null;
  prepare(query: string) {
    return {
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (query.startsWith('INSERT INTO command_ledger') && this.row === null)
            this.row = {
              game_id: values[0],
              command_id: values[1],
              actor_id: values[2],
              command_type: values[3],
              payload_hash: values[4],
              status: 'PENDING',
              result_status: null,
              result_json: null,
              result_transaction_id: null,
            };
          return { meta: { changes: 1 } };
        },
        first: async () => this.row,
      }),
    };
  }
}
