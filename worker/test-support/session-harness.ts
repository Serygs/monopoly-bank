import { GameSession } from '../game-session.js';
import { fakeLedger, type FakeLedger } from './fake-ledger.js';

export interface SessionInternals {
  mutate(gameId: string, userId: string, request: Request): Promise<Response>;
  banking(command: string): unknown;
  access(): unknown;
  authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
  commandLedger(): FakeLedger;
  afterCommit(stage: string): Promise<void>;
}

export interface SessionHarness {
  session: SessionInternals;
  sockets: string[][];
  messages: string[];
  ledger: FakeLedger;
}

export interface SessionHarnessOptions {
  sockets?: number;
  failCompleteOnce?: boolean;
  authorizeAll?: boolean;
}

export function createSessionHarness(options: SessionHarnessOptions = {}): SessionHarness {
  const sockets: string[][] = Array.from({ length: options.sockets ?? 0 }, () => []);
  const storage = new Map<string, unknown>();
  const context = {
    storage: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
    getWebSockets: () =>
      sockets.map((messages) => ({ send: (message: string) => messages.push(message) })),
  };
  const session = new GameSession(context as never, {} as Env) as unknown as SessionInternals;
  const ledger = fakeLedger({ failCompleteOnce: options.failCompleteOnce === true });
  session.commandLedger = () => ledger;
  if (options.authorizeAll !== false) session.authorizeMutation = async () => undefined;
  return { session, sockets, messages: sockets[0] ?? [], ledger };
}
