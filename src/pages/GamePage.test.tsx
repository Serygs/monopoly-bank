import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api';
import type { LiveServerEvent } from '../../shared/contracts/live';
import type { GameStatus, Player } from '../../shared/types/monopoly';

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

function renderedPlayerNames(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(renderedPlayerNames);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const props = (node as { props: { children?: ReactNode; player?: unknown } }).props;
  const currentName =
    props.player !== null &&
    typeof props.player === 'object' &&
    'name' in props.player &&
    typeof props.player.name === 'string'
      ? [props.player.name]
      : [];
  return currentName.concat(renderedPlayerNames(props.children));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
