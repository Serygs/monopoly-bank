import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api';
import type { LiveServerEvent } from '../../shared/contracts/live';
import { defaultGameRules, type GameStatus, type Player } from '../../shared/types/monopoly';

const hooks = vi.hoisted(() => {
  interface EffectSlot {
    cleanup?: () => void;
    dependencies?: readonly unknown[];
  }
  interface StateSlot {
    value: unknown;
    set: (value: unknown) => void;
  }

  let stateCursor = 0;
  let refCursor = 0;
  let callbackCursor = 0;
  let effectCursor = 0;
  let states: StateSlot[] = [];
  let refs: Array<{ current: unknown }> = [];
  let callbacks: Array<{ callback: unknown; dependencies: readonly unknown[] }> = [];
  let effects: EffectSlot[] = [];
  let pendingEffects: Array<{ index: number; effect: () => void | (() => void) }> = [];

  const dependenciesEqual = (
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ) =>
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));

  return {
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
      callbackCursor = 0;
      effectCursor = 0;
    },
    useState<T>(initial: T | (() => T)) {
      const index = stateCursor++;
      if (states[index] === undefined) {
        const slot: StateSlot = {
          value: typeof initial === 'function' ? (initial as () => T)() : initial,
          set(value) {
            slot.value = typeof value === 'function' ? value(slot.value) : value;
          },
        };
        states[index] = slot;
      }
      const slot = states[index];
      return [slot.value as T, slot.set] as const;
    },
    useRef<T>(initial: T) {
      const index = refCursor++;
      if (refs[index] === undefined) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useCallback<T>(callback: T, dependencies: readonly unknown[]) {
      const index = callbackCursor++;
      const previous = callbacks[index];
      if (previous === undefined || !dependenciesEqual(previous.dependencies, dependencies))
        callbacks[index] = { callback, dependencies };
      return callbacks[index].callback as T;
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous === undefined || !dependenciesEqual(previous.dependencies, dependencies)) {
        effects[index] = { cleanup: previous?.cleanup, dependencies };
        pendingEffects.push({ index, effect });
      }
    },
    flushEffects() {
      const pending = pendingEffects;
      pendingEffects = [];
      for (const { index, effect } of pending) {
        effects[index].cleanup?.();
        const cleanup = effect();
        effects[index].cleanup = cleanup ?? undefined;
      }
    },
    value<T>(index: number) {
      return states[index]?.value as T;
    },
    unmount() {
      for (const effect of effects) effect.cleanup?.();
      effects = [];
      pendingEffects = [];
    },
    reset() {
      states = [];
      refs = [];
      callbacks = [];
      effects = [];
      pendingEffects = [];
      this.beginRender();
    },
  };
});

const api = vi.hoisted(() => ({
  getGame: vi.fn(),
  listPaymentRequests: vi.fn(),
  getActivity: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

vi.mock('../api/monopoly-bank-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  monopolyBankApi: api,
}));

vi.mock('../i18n/language-context', () => ({
  useLanguage: () => ({
    language: 'en',
    locale: 'en-US',
    t: (key: string) => key,
  }),
}));
// The hook stand-ins above do not cover `useContext`, so the toast hook is stubbed directly.
vi.mock('../components/ui/useFeedback', () => ({
  useFeedback: () => () => undefined,
}));

import { GamePage } from './GamePage';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closeCode: number | undefined;

  constructor(url: URL | string) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(event: LiveServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  send(message: string) {
    this.sent.push(message);
  }

  close(code?: number) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCode = code;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const owner = player('owner', 'Owner');
const joined = player('joined', 'Joined player');

describe('GamePage live connection lifecycle', () => {
  const setTimeoutMock = vi.fn(() => 2);

  beforeEach(() => {
    hooks.reset();
    api.getGame.mockReset();
    api.listPaymentRequests.mockReset().mockResolvedValue([]);
    api.getActivity
      .mockReset()
      .mockResolvedValue({ transactions: [], paymentRequests: [], nextCursor: null });
    FakeWebSocket.instances.length = 0;
    setTimeoutMock.mockClear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: setTimeoutMock,
      clearTimeout: vi.fn(),
    });
  });

  afterEach(() => {
    hooks.unmount();
    vi.unstubAllGlobals();
  });

  it('keeps one socket from LOBBY through ACTIVE and applies lobby, snapshot, and active events', async () => {
    api.getGame.mockResolvedValue(gameDetails('LOBBY', [owner]));

    renderGamePage(false);
    hooks.flushEffects();
    await flushPromises();
    renderGamePage(false);
    hooks.flushEffects();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(api.listPaymentRequests).not.toHaveBeenCalled();
    const socket = FakeWebSocket.instances[0];

    socket.message(snapshot(0, gameDetails('LOBBY', [owner, joined])));
    let page = renderGamePage(false);
    hooks.flushEffects();
    expect(renderedPlayerNames(page)).toContain(joined.name);
    expect(FakeWebSocket.instances).toHaveLength(1);

    socket.message({
      type: 'LOBBY_UPDATED',
      stateVersion: 1,
      details: gameDetails('LOBBY', [owner, joined]),
    });
    page = renderGamePage(false);
    hooks.flushEffects();
    expect(renderedPlayerNames(page)).toContain(joined.name);

    socket.message({
      type: 'LOBBY_UPDATED',
      stateVersion: 2,
      details: gameDetails('ACTIVE', [owner, joined]),
    });
    renderGamePage(false);
    hooks.flushEffects();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.readyState).not.toBe(FakeWebSocket.CLOSED);
    expect(api.listPaymentRequests).toHaveBeenCalledTimes(1);

    const updatedOwner = { ...owner, balance: 1700 };
    socket.message({
      type: 'GAME_COMMITTED',
      stateVersion: 3,
      transaction: {
        id: 'transaction-1',
        gameId: 'game-1',
        type: 'BANK_TO_PLAYER',
        amount: 200,
        totalAmount: 200,
        comment: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        participants: [{ playerId: owner.id, balanceDelta: 200 }],
      },
      players: [updatedOwner, joined],
    });
    expect(hooks.value<GameDetails>(0).players[0].balance).toBe(1700);

    socket.message({
      type: 'GAME_FINISHED',
      stateVersion: 4,
      details: gameDetails('FINISHED', [updatedOwner, joined]),
    });
    renderGamePage(false);
    hooks.flushEffects();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('seeds the recent list from the first activity page after a reload and merges live rows', async () => {
    const row = (id: string, createdAt: string) => ({
      id,
      gameId: 'game-1',
      type: 'BANK_TO_PLAYER' as const,
      amount: 10,
      totalAmount: 10,
      comment: null,
      createdAt,
      participants: [{ playerId: owner.id, balanceDelta: 10 }],
    });
    api.getGame.mockResolvedValue(gameDetails('ACTIVE', [owner]));
    api.getActivity.mockResolvedValue({
      transactions: [
        row('t3', '2026-01-03T00:00:00.000Z'),
        row('t2', '2026-01-02T00:00:00.000Z'),
        row('t1', '2026-01-01T00:00:00.000Z'),
      ],
      paymentRequests: [],
      nextCursor: null,
    });

    renderGamePage(false);
    hooks.flushEffects();
    await flushPromises();
    renderGamePage(false);
    hooks.flushEffects();
    await flushPromises();
    let page = renderGamePage(false);
    hooks.flushEffects();

    expect(api.getActivity).toHaveBeenCalledTimes(1);
    expect(api.getActivity).toHaveBeenCalledWith('game-1', 'ALL');
    expect(recentIds(page)).toEqual(['t3', 't2', 't1']);

    FakeWebSocket.instances[0].message({
      type: 'GAME_COMMITTED',
      stateVersion: 1,
      transaction: row('t4', '2026-01-04T00:00:00.000Z'),
      players: [owner],
    });
    FakeWebSocket.instances[0].message({
      type: 'GAME_COMMITTED',
      stateVersion: 2,
      transaction: row('t3', '2026-01-03T00:00:00.000Z'),
      players: [owner],
    });
    page = renderGamePage(false);
    expect(recentIds(page)).toEqual(['t4', 't3', 't2']);
  });

  it.each([
    { status: 'FINISHED' as const, offline: false },
    { status: 'LOBBY' as const, offline: true },
  ])(
    'does not connect when status is $status and offline is $offline',
    async ({ status, offline }) => {
      api.getGame.mockResolvedValue(gameDetails(status, [owner]));

      renderGamePage(offline);
      hooks.flushEffects();
      await flushPromises();
      renderGamePage(offline);
      hooks.flushEffects();

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(api.listPaymentRequests).not.toHaveBeenCalled();
    },
  );

  it('preserves ACTIVE reconnect-on-version-gap behavior', async () => {
    api.getGame.mockResolvedValue(gameDetails('ACTIVE', [owner]));

    renderGamePage(false);
    hooks.flushEffects();
    await flushPromises();
    renderGamePage(false);
    hooks.flushEffects();

    const socket = FakeWebSocket.instances[0];
    socket.message(snapshot(7, gameDetails('ACTIVE', [owner])));
    socket.message({ type: 'HEARTBEAT', stateVersion: 9 });

    expect(socket.closeCode).toBe(4001);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
  });
});

function renderGamePage(offline: boolean): ReactElement {
  hooks.beginRender();
  return GamePage({
    gameId: 'game-1',
    offline,
    onBack: () => undefined,
    onPaymentFlowChange: () => undefined,
    preferences: {
      visualStyle: 'classic-bank',
      colorMode: 'system',
      sound: false,
      vibration: false,
      keepScreenAwake: false,
    },
  });
}

function gameDetails(status: GameStatus, players: Player[]): GameDetails {
  return {
    game: {
      id: 'game-1',
      name: 'Realtime game',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      paymentMode: 'FAST',
      rules: defaultGameRules,
      settings: null,
      status,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    players,
    controlledPlayerIds: [owner.id],
    controlledWallets: [{ playerId: owner.id, kind: 'PRIMARY' }],
    canManage: true,
  };
}

function player(id: string, name: string): Player {
  return {
    id,
    gameId: 'game-1',
    name,
    color: '#126247',
    balance: 1500,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function snapshot(stateVersion: number, details: GameDetails): LiveServerEvent {
  return {
    type: 'GAME_SNAPSHOT',
    state: { stateVersion, details, transactions: [] },
  };
}

/** Names handed to player-rendering children: `player`, or `WalletsSection`'s wallet props. */
function renderedPlayerNames(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(renderedPlayerNames);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const props = (
    node as {
      props: {
        children?: ReactNode;
        player?: unknown;
        activeWallet?: unknown;
        otherPlayers?: unknown;
      };
    }
  ).props;
  const candidates = [
    props.player,
    props.activeWallet,
    ...(Array.isArray(props.otherPlayers) ? props.otherPlayers : []),
  ];
  const currentNames = candidates.flatMap((candidate) =>
    candidate !== null &&
    typeof candidate === 'object' &&
    'name' in candidate &&
    typeof candidate.name === 'string'
      ? [candidate.name]
      : [],
  );
  return currentNames.concat(renderedPlayerNames(props.children));
}

/** The ids `WalletsSection` receives as its recent transactions. */
function recentIds(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = recentIds(child);
      if (found.length > 0) return found;
    }
    return [];
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const props = (node as { props: { children?: ReactNode; recentTransactions?: unknown } }).props;
  if (Array.isArray(props.recentTransactions))
    return (props.recentTransactions as Array<{ id: string }>).map((item) => item.id);
  return recentIds(props.children);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function liveStatusOf(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = liveStatusOf(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return undefined;
  const props = (node as { props: { children?: ReactNode; liveStatus?: unknown } }).props;
  return typeof props.liveStatus === 'string' ? props.liveStatus : liveStatusOf(props.children);
}

describe('GamePage live connection recovery', () => {
  interface Timer {
    id: number;
    callback: () => void;
    delay: number;
    cleared: boolean;
  }
  let intervals: Timer[];
  let timeouts: Timer[];
  const register = (list: Timer[]) => (callback: () => void, delay: number) => {
    const timer = { id: list.length + 1, callback, delay, cleared: false };
    list.push(timer);
    return timer.id;
  };
  const clear = (list: Timer[]) => (id: number) => {
    const timer = list.find((item) => item.id === id);
    if (timer !== undefined) timer.cleared = true;
  };
  const rendered = (offline = false) => {
    const page = renderGamePage(offline);
    hooks.flushEffects();
    return page;
  };
  async function connected() {
    api.getGame.mockResolvedValue(gameDetails('ACTIVE', [owner]));
    rendered();
    await flushPromises();
    rendered();
    return FakeWebSocket.instances[0] as FakeWebSocket;
  }

  beforeEach(() => {
    hooks.reset();
    api.getGame.mockReset();
    api.listPaymentRequests.mockReset().mockResolvedValue([]);
    api.getActivity
      .mockReset()
      .mockResolvedValue({ transactions: [], paymentRequests: [], nextCursor: null });
    FakeWebSocket.instances.length = 0;
    intervals = [];
    timeouts = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('window', {
      location: { origin: 'https://bank.example', protocol: 'https:' },
      setInterval: register(intervals),
      clearInterval: clear(intervals),
      setTimeout: register(timeouts),
      clearTimeout: clear(timeouts),
    });
  });

  afterEach(() => {
    hooks.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects to the game’s own live address over a secure socket', async () => {
    const socket = await connected();
    expect(socket.url).toBe('wss://bank.example/api/games/game-1/live');
  });

  it('uses an insecure socket on an insecure page and encodes the game id', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5173', protocol: 'http:' },
      setInterval: register(intervals),
      clearInterval: clear(intervals),
      setTimeout: register(timeouts),
      clearTimeout: clear(timeouts),
    });
    const socket = await connected();
    expect(socket.url).toBe('ws://localhost:5173/api/games/game-1/live');
  });

  it('goes from connecting to live when the socket opens', async () => {
    const socket = await connected();
    expect(liveStatusOf(rendered())).toBe('connecting');
    socket.open();
    expect(liveStatusOf(rendered())).toBe('live');
  });

  it('sends a heartbeat every 20 seconds while the socket is open and none once it is closed', async () => {
    const socket = await connected();
    socket.open();
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.delay).toBe(20_000);
    intervals[0]?.callback();
    intervals[0]?.callback();
    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'HEARTBEAT' }),
      JSON.stringify({ type: 'HEARTBEAT' }),
    ]);
    socket.readyState = FakeWebSocket.CLOSED;
    intervals[0]?.callback();
    expect(socket.sent).toHaveLength(2);
  });

  it('stops the heartbeat when the socket closes', async () => {
    const socket = await connected();
    socket.open();
    socket.close();
    expect(intervals[0]?.cleared).toBe(true);
  });

  it('shows offline after a close and reconnects after a jittered, growing delay', async () => {
    const socket = await connected();
    socket.open();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    socket.close();
    expect(liveStatusOf(rendered())).toBe('offline');
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]?.delay).toBe(1000);
    timeouts[0]?.callback();
    expect(liveStatusOf(rendered())).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1] as FakeWebSocket;
    second.close();
    expect(timeouts[1]?.delay).toBe(2000);
    timeouts[1]?.callback();
    FakeWebSocket.instances[2]?.close();
    expect(timeouts[2]?.delay).toBe(4000);
  });

  it('caps the delay at ten seconds and keeps it within 30% either side', async () => {
    await connected();
    const delays: number[] = [];
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      FakeWebSocket.instances.at(-1)?.close();
      delays.push(timeouts.at(-1)?.delay ?? 0);
      timeouts.at(-1)?.callback();
    }
    expect(delays).toEqual([700, 1400, 2800, 5600, 7000, 7000]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    FakeWebSocket.instances.at(-1)?.close();
    expect(timeouts.at(-1)?.delay).toBe(13000);
  });

  it('starts the delay over after a connection succeeds', async () => {
    await connected();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeWebSocket.instances[0]?.close();
    timeouts[0]?.callback();
    FakeWebSocket.instances[1]?.close();
    expect(timeouts[1]?.delay).toBe(2000);
    timeouts[1]?.callback();
    FakeWebSocket.instances[2]?.open();
    FakeWebSocket.instances[2]?.close();
    expect(timeouts[2]?.delay).toBe(1000);
  });

  it('closes a failing socket so the normal reconnect takes over', async () => {
    const socket = await connected();
    socket.onerror?.();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(timeouts).toHaveLength(1);
  });

  it('ignores everything a replaced socket still says', async () => {
    const first = await connected();
    first.open();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    first.close();
    timeouts[0]?.callback();
    const second = FakeWebSocket.instances[1] as FakeWebSocket;
    first.onopen?.();
    first.onerror?.();
    first.onclose?.();
    first.message(snapshot(5, gameDetails('ACTIVE', [owner, joined])));
    expect(timeouts).toHaveLength(1);
    expect(second.readyState).not.toBe(FakeWebSocket.CLOSED);
    expect(renderedPlayerNames(rendered())).not.toContain(joined.name);
  });

  it('applies a snapshot of any version, then accepts the next version and refuses a gap', async () => {
    const socket = await connected();
    socket.message(snapshot(10, gameDetails('ACTIVE', [owner, joined])));
    expect(renderedPlayerNames(rendered())).toContain(joined.name);
    socket.message({ type: 'HEARTBEAT', stateVersion: 11 });
    expect(socket.closeCode).toBeUndefined();
    socket.message({ type: 'HEARTBEAT', stateVersion: 13 });
    expect(socket.closeCode).toBe(4001);
  });

  it('applies a second event of the same version, and resyncs on an older one', async () => {
    const socket = await connected();
    socket.message(snapshot(10, gameDetails('ACTIVE', [owner])));
    const commit = (stateVersion: number, balance: number): LiveServerEvent => ({
      type: 'GAME_COMMITTED',
      stateVersion,
      transaction: {
        id: `t${stateVersion}-${balance}`,
        gameId: 'game-1',
        type: 'BANK_TO_PLAYER',
        amount: 5,
        totalAmount: 5,
        comment: null,
        createdAt: '',
        participants: [],
      },
      players: [{ ...owner, balance }],
    });
    socket.message(commit(10, 1));
    expect(socket.closeCode).toBeUndefined();
    expect(hooks.value<GameDetails>(0).players[0]?.balance).toBe(1);
    socket.message(commit(9, 2));
    expect(socket.closeCode).toBe(4001);
    expect(hooks.value<GameDetails>(0).players[0]?.balance).toBe(1);
  });

  it('reloads the payment requests when the server says they changed', async () => {
    const socket = await connected();
    const calls = api.listPaymentRequests.mock.calls.length;
    socket.message({ type: 'PAYMENT_REQUESTS_UPDATED', stateVersion: 1 });
    expect(api.listPaymentRequests.mock.calls.length).toBe(calls + 1);
  });

  it('ignores a message that is not JSON or not a live event', async () => {
    const socket = await connected();
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'SOMETHING_ELSE', stateVersion: 1 }) });
    socket.onmessage?.({ data: JSON.stringify(null) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'HEARTBEAT' }) });
    expect(socket.closeCode).toBeUndefined();
    expect(socket.readyState).not.toBe(FakeWebSocket.CLOSED);
  });

  it('keeps at most fifty live transactions, newest first', async () => {
    const socket = await connected();
    for (let version = 1; version <= 55; version += 1)
      socket.message({
        type: 'GAME_COMMITTED',
        stateVersion: version,
        transaction: {
          id: `t${version}`,
          gameId: 'game-1',
          type: 'BANK_TO_PLAYER',
          amount: 1,
          totalAmount: 1,
          comment: null,
          createdAt: '',
          participants: [{ playerId: owner.id, balanceDelta: 1 }],
        },
        players: [owner],
      });
    const ids = recentIds(rendered());
    expect(ids[0]).toBe('t55');
    expect(ids.length).toBeLessThanOrEqual(50);
  });

  it('closes the socket and clears the timers when the page goes away', async () => {
    const socket = await connected();
    socket.open();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    hooks.unmount();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(intervals[0]?.cleared).toBe(true);
    expect(timeouts).toHaveLength(0);
  });

  it('cancels a pending reconnect when the page goes away', async () => {
    const socket = await connected();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    socket.close();
    hooks.unmount();
    expect(timeouts[0]?.cleared).toBe(true);
    timeouts[0]?.callback();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
