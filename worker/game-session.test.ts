import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../shared/contracts/api.js';
import type { LiveGameState, LiveServerEvent } from '../shared/contracts/live.js';
import type { GameProperty, Player } from '../shared/types/monopoly.js';
import { classicBoard, classicBuildingBank, classicSpaces, emptyClassicProperties } from './classic-board.test-support.js';
import { GameSession } from './game-session.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';

describe('GameSession live coordinator', () => {
  it('broadcasts one authoritative update to every client and replays duplicate command IDs', async () => {
    const sent: string[][] = [[], []];
    const storage = new Map<string, unknown>();
    const context = {
      storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } },
      getWebSockets: () => sent.map((messages) => ({ send: (message: string) => messages.push(message) })),
    };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): { createTransaction(): Promise<unknown> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    let calls = 0;
    session.banking = () => ({ createTransaction: async () => {
      calls += 1;
      return { transaction: { id: commandId, gameId, type: 'PLAYER_TO_BANK', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }, players: [] };
    } });
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'CREATE_TRANSACTION', commandId, request: { type: 'PLAYER_TO_BANK', playerId: '00000000-0000-4000-8000-000000000003', amount: 100 } }) });

    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect(calls).toBe(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]).toEqual(sent[1]);
    expect(JSON.parse(sent[0][0])).toMatchObject({ type: 'GAME_COMMITTED', stateVersion: 1, transaction: { id: commandId }, players: [] });
  });

  it('replays a PROPERTY_OPERATION command by its ID from the ledger without a second write', async () => {
    const sent: string[] = [];
    const storage = new Map<string, unknown>();
    const context = { storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } }, getWebSockets: () => [{ send: (message: string) => sent.push(message) }] };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      properties(command: string): { purchase(): Promise<unknown> };
      deeds(): { listProperties(): Promise<unknown[]> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    let purchases = 0;
    const transaction = { id: commandId, gameId, type: 'PROPERTY_PURCHASE', amount: 60, totalAmount: 60, comment: null, createdAt: '', participants: [{ playerId: '00000000-0000-4000-8000-000000000003', balanceDelta: -60 }] };
    session.properties = () => ({ purchase: async () => { purchases += 1; return { transaction, players: [], properties: [{ boardSpaceId: 'board-classic-space-01', ownerPlayerId: '00000000-0000-4000-8000-000000000003', houses: 0, mortgaged: false }], buildingBank: { housesAvailable: 32, hotelsAvailable: 12 } }; } });
    session.deeds = () => ({ listProperties: async () => [] });
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'PROPERTY_OPERATION', commandId, operation: 'PURCHASE', request: { playerId: '00000000-0000-4000-8000-000000000003', boardSpaceId: 'board-classic-space-01' } }) });

    const first = await session.mutate(gameId, 'actor', request());
    const second = await session.mutate(gameId, 'actor', request());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(second.json()).resolves.toEqual(await first.clone().json());
    expect(purchases).toBe(1);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ type: 'GAME_COMMITTED', stateVersion: 1, transaction: { id: commandId, type: 'PROPERTY_PURCHASE' } });
  });

  it('authorizes a rent claim against the owner stored on the deed, not a wallet the request names', async () => {
    const session = new GameSession({} as never, {} as Env) as unknown as {
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      properties(command: string): { ownerOf(): Promise<string | null> };
      access(): { requireMember(): Promise<void>; requirePlayerController(gameId: string, userId: string, playerId: string): Promise<void> };
    };
    const controllers: string[] = [];
    session.properties = () => ({ ownerOf: async () => '00000000-0000-4000-8000-0000000000aa' });
    session.access = () => ({ requireMember: async () => undefined, requirePlayerController: async (_gameId, _userId, playerId) => { controllers.push(playerId); } });
    await session.authorizeMutation(gameId, 'actor', { type: 'PROPERTY_OPERATION', commandId, operation: 'RENT', request: { payerPlayerId: '00000000-0000-4000-8000-000000000003', boardSpaceId: 'board-classic-space-01', chargedByOwner: true, ownerPlayerId: '00000000-0000-4000-8000-0000000000ff' } });
    await session.authorizeMutation(gameId, 'actor', { type: 'PROPERTY_OPERATION', commandId, operation: 'RENT', request: { payerPlayerId: '00000000-0000-4000-8000-000000000003', boardSpaceId: 'board-classic-space-01' } });
    expect(controllers).toEqual(['00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000003']);
    session.properties = () => ({ ownerOf: async () => null });
    await expect(session.authorizeMutation(gameId, 'actor', { type: 'PROPERTY_OPERATION', commandId, operation: 'RENT', request: { payerPlayerId: '00000000-0000-4000-8000-000000000003', boardSpaceId: 'board-classic-space-01', chargedByOwner: true } })).rejects.toMatchObject({ code: 'PROPERTY_NOT_OWNED', status: 400 });
  });

  it('rejects requests that did not come through the authenticated Worker gateway', async () => {
    const session = new GameSession({} as never, {} as Env);
    expect((await session.fetch(new Request('https://game-session/mutation'))).status).toBe(403);
  });

  it('serializes duplicate payment-request accept commands into one settlement', async () => {
    const storage = new Map<string, unknown>();
    const context = { storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } }, getWebSockets: () => [] };
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      banking(command: string): { acceptPaymentRequest(): Promise<unknown> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    let settlements = 0;
    session.banking = () => ({ acceptPaymentRequest: async () => { settlements += 1; return { paymentRequest: { id: '00000000-0000-4000-8000-000000000003', state: 'ACCEPTED' }, transaction: { id: commandId, gameId, type: 'PLAYER_TO_PLAYER', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }, players: [] }; } });
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'ACCEPT_PAYMENT_REQUEST', commandId, paymentRequestId: '00000000-0000-4000-8000-000000000003' }) });
    await Promise.all([session.mutate(gameId, 'actor', request()), session.mutate(gameId, 'actor', request())]);
    expect(settlements).toBe(1);
  });

  it('recovers after completion failure: 20 parallel retries leave one transaction and one balance delta', async () => {
    const storage = new Map<string, unknown>();
    const context = { storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } }, getWebSockets: () => [] };
    const session = new GameSession(context as never, {} as Env) as unknown as { mutate(gameId: string, userId: string, request: Request): Promise<Response>; banking(command: string): { createTransaction(): Promise<unknown> }; authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>; commandLedger(): ReturnType<typeof fakeLedger>; };
    const ledger = fakeLedger({ failCompleteOnce: true }); let transactionCount = 0; let balanceDelta = 0; let persisted = false;
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    session.banking = () => ({ createTransaction: async () => { if (!persisted) { persisted = true; transactionCount += 1; balanceDelta -= 100; } return { transaction: { id: commandId, gameId, type: 'PLAYER_TO_BANK', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }, players: [] }; } });
    const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'CREATE_TRANSACTION', commandId, request: { type: 'PLAYER_TO_BANK', playerId: '00000000-0000-4000-8000-000000000003', amount: 100 } }) });
    const firstWave = await Promise.all(Array.from({ length: 20 }, () => session.mutate(gameId, 'actor', request())));
    expect(firstWave.every((response) => response.status === 500 || response.status === 201)).toBe(true);
    expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
    expect(transactionCount).toBe(1);
    expect(balanceDelta).toBe(-100);
  });

  it('does not duplicate a committed transaction when every post-commit await is fault-injected', async () => {
    for (const stage of ['executed', 'ledger-completed', 'version-incremented', 'published'] as const) {
      const storage = new Map<string, unknown>(); const context = { storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } }, getWebSockets: () => [] };
      const session = new GameSession(context as never, {} as Env) as unknown as { mutate(gameId: string, userId: string, request: Request): Promise<Response>; banking(command: string): { createTransaction(): Promise<unknown> }; authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>; commandLedger(): ReturnType<typeof fakeLedger>; afterCommit(stage: string): Promise<void>; };
      const ledger = fakeLedger(); let transactionCount = 0; let delta = 0; let persisted = false; let fail = true;
      session.commandLedger = () => ledger; session.authorizeMutation = async () => undefined;
      session.banking = () => ({ createTransaction: async () => { if (!persisted) { persisted = true; transactionCount += 1; delta -= 100; } return { transaction: { id: commandId, gameId, type: 'PLAYER_TO_BANK', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }, players: [] }; } });
      session.afterCommit = async (current) => { if (current === stage && fail) { fail = false; throw new Error(`Injected ${stage}`); } };
      const request = () => new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify({ type: 'CREATE_TRANSACTION', commandId, request: { type: 'PLAYER_TO_BANK', playerId: '00000000-0000-4000-8000-000000000003', amount: 100 } }) });
      expect((await session.mutate(gameId, 'actor', request())).status).toBe(500);
      expect((await session.mutate(gameId, 'actor', request())).status).toBe(201);
      expect({ transactionCount, delta }).toEqual({ transactionCount: 1, delta: -100 });
    }
  });

  it('isolates a broken socket while delivering the committed event to healthy clients', async () => {
    const delivered: string[] = []; let closed = false;
    const context = { storage: { get: async <T>() => undefined as T | undefined, put: async () => undefined }, getWebSockets: () => [{ send: () => { throw new Error('broken'); }, close: () => { closed = true; } }, { send: (message: string) => delivered.push(message), close: () => undefined }] };
    const session = new GameSession(context as never, {} as Env) as unknown as { broadcast(event: unknown): Promise<void> };
    await session.broadcast({ type: 'HEARTBEAT', stateVersion: 2 });
    expect(closed).toBe(true);
    expect(delivered).toEqual([JSON.stringify({ type: 'HEARTBEAT', stateVersion: 2 })]);
  });

  it('counts multiple hibernatable sockets for one actor as one presence', () => {
    const context = { getWebSockets: () => [{ deserializeAttachment: () => ({ userId: 'actor-a' }) }, { deserializeAttachment: () => ({ userId: 'actor-a' }) }, { deserializeAttachment: () => ({ userId: 'actor-b' }) }] };
    const session = new GameSession(context as never, {} as Env) as unknown as { connectedActors(): number };
    expect(session.connectedActors()).toBe(2);
  });
});

describe('GameSession board fan-out and snapshots', () => {
  const ada = '00000000-0000-4000-8000-0000000000b1';
  const lin = '00000000-0000-4000-8000-0000000000b2';
  const brownOne = 'board-classic-space-01';
  const brownTwo = 'board-classic-space-03';
  const railroad = 'board-classic-space-05';
  const commands = { purchase: '00000000-0000-4000-8000-000000000011', propose: '00000000-0000-4000-8000-000000000012', roll: '00000000-0000-4000-8000-000000000013', accept: '00000000-0000-4000-8000-000000000014', bail: '00000000-0000-4000-8000-000000000015', bankrupt: '00000000-0000-4000-8000-000000000016' };

  function player(id: string, overrides: Partial<Player> = {}): Player { return { id, gameId, name: id === ada ? 'Ada' : 'Lin', color: '#1', balance: 1500, status: 'ACTIVE', isInJail: false, consecutiveDoubles: 0, lastRollTotal: null, lastRollAt: null, userId: null, createdAt: '2026-01-01T00:00:00Z', ...overrides }; }
  function transaction(id: string, type: string) { return { id, gameId, type, amount: 60, totalAmount: 60, comment: null, createdAt: '2026-01-01T00:00:00Z', participants: [{ playerId: ada, balanceDelta: -60 }] }; }
  function withDeed(properties: readonly GameProperty[], boardSpaceId: string, patch: Partial<GameProperty>): GameProperty[] { return properties.map((property) => (property.boardSpaceId === boardSpaceId ? { ...property, ...patch } : property)); }
  function mutation(body: object): Request { return new Request('https://game-session/mutation', { method: 'POST', body: JSON.stringify(body) }); }
  function parse(messages: readonly string[]): LiveServerEvent[] { return messages.map((message) => JSON.parse(message) as LiveServerEvent); }

  /** A coordinator wired to in-memory fakes: two sockets, a deed table the fakes read and write, and a game service that mirrors it. */
  function boardSession(initialDeeds: GameProperty[] = emptyClassicProperties(), players: Player[] = [player(ada), player(lin)]) {
    const sockets: string[][] = [[], []];
    const storage = new Map<string, unknown>();
    const deeds = { current: initialDeeds };
    const wallets = { current: players };
    const context = { storage: { get: async <T>(key: string) => storage.get(key) as T | undefined, put: async (key: string, value: unknown) => { storage.set(key, value); } }, getWebSockets: () => sockets.map((messages) => ({ send: (message: string) => messages.push(message) })) };
    const details = (): GameDetails => ({ game: { id: gameId, name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '', updatedAt: '', boardId: classicBoard.id }, players: wallets.current, favoriteAmounts: [], recentAmounts: [], board: classicBoard, boardSpaces: classicSpaces, properties: deeds.current, buildingBank: classicBuildingBank });
    const session = new GameSession(context as never, {} as Env) as unknown as {
      mutate(gameId: string, userId: string, request: Request): Promise<Response>;
      state(gameId: string, userId: string, details?: GameDetails): Promise<LiveGameState>;
      properties(command: string): Record<string, () => Promise<unknown>>;
      trades(command: string): Record<string, () => Promise<unknown>>;
      banking(command: string): Record<string, () => Promise<unknown>>;
      deeds(): { listProperties(): Promise<GameProperty[]> };
      gameService(): { getGame(): Promise<GameDetails> };
      access(): { controlledWallets(): Promise<{ playerId: string; kind: 'PRIMARY' }[]> };
      transactions(): { listByGameId(): Promise<unknown[]> };
      authorizeMutation(gameId: string, userId: string, command: unknown): Promise<void>;
      commandLedger(): ReturnType<typeof fakeLedger>;
    };
    const ledger = fakeLedger();
    session.commandLedger = () => ledger;
    session.authorizeMutation = async () => undefined;
    session.deeds = () => ({ listProperties: async () => structuredClone(deeds.current) });
    session.gameService = () => ({ getGame: async () => details() });
    session.access = () => ({ controlledWallets: async () => [{ playerId: ada, kind: 'PRIMARY' }] });
    session.transactions = () => ({ listByGameId: async () => [] });
    const slice = () => ({ properties: structuredClone(deeds.current), buildingBank: classicBuildingBank });
    session.properties = (id) => ({
      purchase: async () => { deeds.current = withDeed(deeds.current, brownOne, { ownerPlayerId: ada }); return { transaction: transaction(id, 'PROPERTY_PURCHASE'), players: wallets.current, ...slice() }; },
      recordDiceRoll: async () => { wallets.current = wallets.current.map((wallet) => (wallet.id === ada ? { ...wallet, isInJail: true, consecutiveDoubles: 0, lastRollTotal: 8 } : wallet)); return { player: wallets.current[0], thirdDouble: true }; },
      payJailBail: async () => { wallets.current = wallets.current.map((wallet) => (wallet.id === ada ? { ...wallet, isInJail: false, balance: wallet.balance - 50 } : wallet)); return { transaction: transaction(id, 'JAIL_BAIL'), players: wallets.current }; },
    });
    session.trades = (id) => ({
      propose: async () => ({ trade: { id: '00000000-0000-4000-8000-000000000077', state: 'PENDING' }, players: wallets.current }),
      accept: async () => { deeds.current = withDeed(withDeed(deeds.current, brownOne, { ownerPlayerId: lin }), railroad, { ownerPlayerId: ada }); return { trade: { id: '00000000-0000-4000-8000-000000000077', state: 'ACCEPTED' }, transaction: transaction(id, 'PROPERTY_TRADE'), players: wallets.current, ...slice() }; },
    });
    session.banking = (id) => ({
      declareBankruptcy: async () => { deeds.current = deeds.current.map((deed) => (deed.ownerPlayerId === ada ? { ...deed, ownerPlayerId: lin, houses: 0 } : deed)); wallets.current = wallets.current.map((wallet) => (wallet.id === ada ? { ...wallet, status: 'BANKRUPT', balance: 0 } : wallet)); return { transaction: transaction(id, 'BANKRUPTCY_TRANSFER'), players: wallets.current, ...slice() }; },
    });
    return { session, sockets, deeds, wallets, details };
  }

  it('fans GAME_COMMITTED with only the changed deeds to every socket, then TRADES_UPDATED and DICE_ROLLED for offers and rolls', async () => {
    const { session, sockets } = boardSession();
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'PROPERTY_OPERATION', commandId: commands.purchase, operation: 'PURCHASE', request: { playerId: ada, boardSpaceId: brownOne } }))).status).toBe(201);
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'PROPOSE_TRADE', commandId: commands.propose, request: { proposerPlayerId: ada, responderPlayerId: lin, propertiesFromProposer: [{ boardSpaceId: brownOne }] } }))).status).toBe(201);
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'DICE_ROLL', commandId: commands.roll, request: { playerId: ada, first: 4, second: 4 } }))).status).toBe(201);

    expect(sockets[0]).toEqual(sockets[1]);
    const events = parse(sockets[0]);
    expect(events.map((event) => event.type)).toEqual(['GAME_COMMITTED', 'TRADES_UPDATED', 'DICE_ROLLED']);
    expect(events[0]).toMatchObject({ type: 'GAME_COMMITTED', stateVersion: 1, transaction: { id: commands.purchase, type: 'PROPERTY_PURCHASE' }, buildingBank: classicBuildingBank });
    expect(events[0].type === 'GAME_COMMITTED' && events[0].properties).toEqual([{ boardSpaceId: brownOne, ownerPlayerId: ada, houses: 0, mortgaged: false }]);
    expect(events[0].type === 'GAME_COMMITTED' && events[0].players).toHaveLength(2);
    expect(events[1]).toEqual({ type: 'TRADES_UPDATED', stateVersion: 2 });
    expect(events[2]).toMatchObject({ type: 'DICE_ROLLED', stateVersion: 3, thirdDouble: true, player: { id: ada, isInJail: true, lastRollTotal: 8 } });
  });

  it('accepting a trade commits both deeds and refreshes the offer list; bail carries the cleared jail flag', async () => {
    const { session, sockets } = boardSession(withDeed(emptyClassicProperties(), brownOne, { ownerPlayerId: ada }), [player(ada, { isInJail: true }), player(lin)]);
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'RESOLVE_TRADE', commandId: commands.accept, tradeId: '00000000-0000-4000-8000-000000000077', action: 'accept' }))).status).toBe(200);
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'JAIL_BAIL', commandId: commands.bail, request: { playerId: ada } }))).status).toBe(201);
    const events = parse(sockets[1]);
    expect(events.map((event) => event.type)).toEqual(['GAME_COMMITTED', 'TRADES_UPDATED', 'GAME_COMMITTED']);
    expect(events[0].type === 'GAME_COMMITTED' && events[0].properties).toEqual([
      { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false },
      { boardSpaceId: railroad, ownerPlayerId: ada, houses: 0, mortgaged: false },
    ]);
    expect(events[2]).toMatchObject({ type: 'GAME_COMMITTED', transaction: { type: 'JAIL_BAIL' }, jailChanges: [{ playerId: ada, isInJail: false }] });
    expect(events[2]).not.toHaveProperty('properties');
  });

  it('bankruptcy on a board commits every deed of the bankrupt estate and names the bankrupt player', async () => {
    const owned = withDeed(withDeed(withDeed(emptyClassicProperties(), brownOne, { ownerPlayerId: ada, houses: 2 }), brownTwo, { ownerPlayerId: ada }), railroad, { ownerPlayerId: lin });
    const { session, sockets } = boardSession(owned);
    expect((await session.mutate(gameId, 'actor', mutation({ type: 'DECLARE_BANKRUPTCY', commandId: commands.bankrupt, request: { playerId: ada, creditorPlayerId: lin } }))).status).toBe(201);
    const [event] = parse(sockets[0]);
    expect(event).toMatchObject({ type: 'GAME_COMMITTED', bankruptPlayerId: ada, buildingBank: classicBuildingBank });
    expect(event.type === 'GAME_COMMITTED' && event.properties).toEqual([
      { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false },
      { boardSpaceId: brownTwo, ownerPlayerId: lin, houses: 0, mortgaged: false },
    ]);
  });

  it('a reconnect after commits receives a GAME_SNAPSHOT whose deeds equal the deeds before plus every committed change', async () => {
    const { session, sockets } = boardSession();
    const before = emptyClassicProperties();
    await session.mutate(gameId, 'actor', mutation({ type: 'PROPERTY_OPERATION', commandId: commands.purchase, operation: 'PURCHASE', request: { playerId: ada, boardSpaceId: brownOne } }));
    await session.mutate(gameId, 'actor', mutation({ type: 'RESOLVE_TRADE', commandId: commands.accept, tradeId: '00000000-0000-4000-8000-000000000077', action: 'accept' }));

    const merged = new Map(before.map((deed) => [deed.boardSpaceId, deed]));
    for (const event of parse(sockets[0])) if (event.type === 'GAME_COMMITTED') for (const deed of event.properties ?? []) merged.set(deed.boardSpaceId, deed);

    const snapshot = await session.state(gameId, 'actor');
    expect(snapshot.stateVersion).toBe(2);
    expect(snapshot.details.properties).toEqual([...merged.values()]);
    expect(snapshot.details.properties?.filter((deed) => deed.ownerPlayerId !== null)).toEqual([
      { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false },
      { boardSpaceId: railroad, ownerPlayerId: ada, houses: 0, mortgaged: false },
    ]);
  });

  it('a snapshot of a classic-board game carries the board, exactly 28 spaces, the deeds, the bank and every player\'s roll and jail state', async () => {
    const six = Array.from({ length: 6 }, (_, index) => player(`00000000-0000-4000-8000-0000000000c${index}`, { name: `Player ${index}`, lastRollTotal: index + 2, lastRollAt: '2026-01-01T00:00:00Z', consecutiveDoubles: index % 3, isInJail: index === 5 }));
    const { session } = boardSession(emptyClassicProperties(), six);
    const state = await session.state(gameId, 'actor');
    expect(state.details.board).toEqual(classicBoard);
    expect(state.details.boardSpaces).toHaveLength(28);
    expect(state.details.properties).toHaveLength(28);
    expect(state.details.buildingBank).toEqual(classicBuildingBank);
    for (const wallet of state.details.players) expect(wallet).toMatchObject({ isInJail: expect.any(Boolean), consecutiveDoubles: expect.any(Number), lastRollTotal: expect.any(Number) });
    for (const space of state.details.boardSpaces ?? []) expect(Object.keys(space).sort()).toEqual(['boardIndex', 'colorGroup', 'customName', 'houseCost', 'id', 'kind', 'mortgageValue', 'price', 'rents', 'translationKey']);
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'GAME_SNAPSHOT', state } satisfies LiveServerEvent)).byteLength;
    console.info(`GAME_SNAPSHOT (classic board, six players): ${bytes} bytes`);
    // Measured at 11 490 bytes; the bound guards against the catalogue-only columns creeping back into the wire shape.
    expect(bytes).toBeLessThan(12 * 1024);
  });

  it('a snapshot of a game without a board carries none of the board fields', async () => {
    const { session } = boardSession();
    session.gameService = () => ({ getGame: async () => ({ game: { id: gameId, name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '', updatedAt: '', boardId: null }, players: [player(ada), player(lin)], favoriteAmounts: [], recentAmounts: [] }) });
    const state = await session.state(gameId, 'actor');
    for (const field of ['board', 'boardSpaces', 'properties', 'buildingBank']) expect(state.details).not.toHaveProperty(field);
    expect(state.details.controlledPlayerIds).toEqual([ada]);
  });
});

function fakeLedger(options: { failCompleteOnce?: boolean } = {}) {
  const entries = new Map<string, { actorId: string; commandType: string; payloadHash: string; status: 'PENDING' | 'COMPLETED'; resultStatus: number | null; resultJson: string | null; resultTransactionId: string | null }>();
  return {
    claim: async (input: { gameId: string; commandId: string; actorId: string; commandType: string; payloadHash: string }) => {
      const existing = entries.get(input.commandId);
      if (existing === undefined) { const entry = { actorId: input.actorId, commandType: input.commandType, payloadHash: input.payloadHash, status: 'PENDING' as const, resultStatus: null, resultJson: null, resultTransactionId: null }; entries.set(input.commandId, entry); return { gameId: input.gameId, commandId: input.commandId, ...entry }; }
      return { gameId: input.gameId, commandId: input.commandId, ...existing };
    },
    complete: async (input: { gameId: string; commandId: string; status: number; result: unknown; transactionId: string | null }) => { if (options.failCompleteOnce === true) { options.failCompleteOnce = false; throw new Error('Injected completion failure'); } const entry = entries.get(input.commandId); if (entry === undefined) throw new Error('Missing command'); entry.status = 'COMPLETED'; entry.resultStatus = input.status; entry.resultJson = JSON.stringify(input.result); entry.resultTransactionId = input.transactionId; },
  };
}
