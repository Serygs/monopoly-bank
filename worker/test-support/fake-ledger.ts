interface LedgerEntry {
  actorId: string;
  commandType: string;
  payloadHash: string;
  status: 'PENDING' | 'COMPLETED';
  resultStatus: number | null;
  resultJson: string | null;
  resultTransactionId: string | null;
}

interface ClaimInput {
  gameId: string;
  commandId: string;
  actorId: string;
  commandType: string;
  payloadHash: string;
}

interface CompleteInput {
  gameId: string;
  commandId: string;
  status: number;
  result: unknown;
  transactionId: string | null;
}

export interface FakeLedger {
  claim(input: ClaimInput): Promise<LedgerEntry & { gameId: string; commandId: string }>;
  complete(input: CompleteInput): Promise<void>;
}

export function fakeLedger(options: { failCompleteOnce?: boolean } = {}): FakeLedger {
  const entries = new Map<string, LedgerEntry>();
  return {
    claim: async (input) => {
      const existing = entries.get(input.commandId);
      if (existing === undefined) {
        const entry: LedgerEntry = {
          actorId: input.actorId,
          commandType: input.commandType,
          payloadHash: input.payloadHash,
          status: 'PENDING',
          resultStatus: null,
          resultJson: null,
          resultTransactionId: null,
        };
        entries.set(input.commandId, entry);
        return { gameId: input.gameId, commandId: input.commandId, ...entry };
      }
      return { gameId: input.gameId, commandId: input.commandId, ...existing };
    },
    complete: async (input) => {
      if (options.failCompleteOnce === true) {
        options.failCompleteOnce = false;
        throw new Error('Injected completion failure');
      }
      const entry = entries.get(input.commandId);
      if (entry === undefined) throw new Error('Missing command');
      entry.status = 'COMPLETED';
      entry.resultStatus = input.status;
      entry.resultJson = JSON.stringify(input.result);
      entry.resultTransactionId = input.transactionId;
    },
  };
}
