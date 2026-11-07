import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { useGameSync } from './useGameSync';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  pong() {
    this.onmessage?.({ data: 'pong' });
  }

  send(message: string) {
    this.sent.push(message);
  }

  /** A real socket on a dead connection stays in CLOSING and reports its close much later. */
  close() {
    this.readyState = 2;
  }
}

const sockets = () => FakeWebSocket.instances;
const latest = () => sockets().at(-1) as FakeWebSocket;
// The longest reconnect wait of the first attempt: one second plus 30% jitter.
const FIRST_RETRY_MS = 1300;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function renderSync() {
  // Stable across renders, as the page's own setters are: a new one would restart the connection.
  const options = {
    gameId: 'game-1',
    enabled: true,
    setDetails: vi.fn(),
    setLiveTransactions: vi.fn(),
    setPaymentRequests: vi.fn(),
    loadPaymentRequests: vi.fn(),
  };
  return renderHook(() => useGameSync(options));
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('useGameSync on a network that stops answering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    setVisibility('visible');
    vi.spyOn(monopolyBankApi, 'getGameVersion').mockResolvedValue({ stateVersion: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('gives up on a handshake that hangs and tries again', async () => {
    const { result } = renderSync();
    await advance(9999);
    expect(result.current.liveStatus).toBe('connecting');
    expect(sockets()).toHaveLength(1);
    await advance(1);
    expect(result.current.liveStatus).toBe('offline');
    await advance(FIRST_RETRY_MS);
    expect(sockets()).toHaveLength(2);
    expect(result.current.liveStatus).toBe('reconnecting');
  });

  it('leaves a handshake that finished in time alone', async () => {
    const { result } = renderSync();
    act(() => latest().open());
    await advance(10_000);
    expect(result.current.liveStatus).toBe('live');
    expect(sockets()).toHaveLength(1);
  });

  it('gives up on an open socket that stopped answering pings', async () => {
    const { result } = renderSync();
    act(() => latest().open());
    await advance(20_000);
    expect(latest().sent).toEqual(['ping']);
    expect(result.current.liveStatus).toBe('live');
    await advance(20_000);
    expect(result.current.liveStatus).toBe('offline');
    await advance(FIRST_RETRY_MS);
    expect(sockets()).toHaveLength(2);
  });

  it('retries after a socket error without waiting for a close that may never come', async () => {
    const { result } = renderSync();
    act(() => latest().open());
    act(() => latest().onerror?.());
    expect(result.current.liveStatus).toBe('offline');
    await advance(FIRST_RETRY_MS);
    expect(sockets()).toHaveLength(2);
  });

  it('gives up on a socket stuck closing', async () => {
    const { result } = renderSync();
    act(() => latest().open());
    latest().close();
    await advance(40_000);
    expect(result.current.liveStatus).toBe('offline');
    await advance(FIRST_RETRY_MS);
    expect(sockets()).toHaveLength(2);
  });

  it('keeps an open socket that answers its pings', async () => {
    const { result } = renderSync();
    const socket = latest();
    act(() => socket.open());
    for (let beat = 0; beat < 4; beat += 1) {
      await advance(20_000);
      act(() => socket.pong());
    }
    expect(result.current.liveStatus).toBe('live');
    expect(sockets()).toHaveLength(1);
  });

  it('does not give up on a silent socket while the page is in the background', async () => {
    const { result } = renderSync();
    act(() => latest().open());
    setVisibility('hidden');
    await advance(60_000);
    expect(result.current.liveStatus).toBe('live');
    expect(sockets()).toHaveLength(1);
  });

  describe('coming back to the page', () => {
    function comeBack() {
      setVisibility('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }

    it('replaces a socket that died in the background', async () => {
      const { result } = renderSync();
      act(() => latest().open());
      setVisibility('hidden');
      await advance(60_000);
      const sentBefore = latest().sent.length;
      comeBack();
      expect(latest().sent).toHaveLength(sentBefore + 1);
      await advance(4999);
      expect(result.current.liveStatus).toBe('live');
      await advance(1);
      expect(result.current.liveStatus).toBe('offline');
      await advance(FIRST_RETRY_MS);
      expect(sockets()).toHaveLength(2);
    });

    it('keeps a socket that answers', async () => {
      const { result } = renderSync();
      const socket = latest();
      act(() => socket.open());
      setVisibility('hidden');
      await advance(60_000);
      comeBack();
      await advance(1000);
      act(() => socket.pong());
      await advance(5000);
      expect(result.current.liveStatus).toBe('live');
      expect(sockets()).toHaveLength(1);
    });

    it('checks on pageshow too', async () => {
      renderSync();
      act(() => latest().open());
      act(() => {
        window.dispatchEvent(new Event('pageshow'));
      });
      expect(latest().sent).toEqual(['ping']);
    });
  });

  describe('a manual refresh', () => {
    it('starts a hanging handshake over at once', async () => {
      const { result } = renderSync();
      const stuck = latest();
      await advance(3000);
      act(() => result.current.refresh.run());
      expect(sockets()).toHaveLength(2);
      expect(stuck.onopen).toBeNull();
      await advance(0);
    });

    it('skips the wait for the next attempt', async () => {
      const { result } = renderSync();
      await advance(10_000);
      expect(sockets()).toHaveLength(1);
      act(() => result.current.refresh.run());
      expect(sockets()).toHaveLength(2);
      await advance(FIRST_RETRY_MS);
      expect(sockets()).toHaveLength(2);
    });

    it('only asks an open socket for a sign of life', async () => {
      const { result } = renderSync();
      act(() => latest().open());
      await advance(0);
      act(() => result.current.refresh.run());
      expect(latest().sent).toEqual(['ping']);
      expect(sockets()).toHaveLength(1);
    });
  });

  it('ignores what an abandoned socket says later', async () => {
    const { result } = renderSync();
    const abandoned = latest();
    await advance(10_000);
    expect(abandoned.onopen).toBeNull();
    expect(abandoned.onmessage).toBeNull();
    expect(abandoned.onclose).toBeNull();
    expect(abandoned.onerror).toBeNull();
    await advance(FIRST_RETRY_MS);
    act(() => latest().open());
    expect(result.current.liveStatus).toBe('live');
  });

  it('stops every timer when the page goes away', async () => {
    const { unmount } = renderSync();
    act(() => latest().open());
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    await advance(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers the refresh once a hanging request has failed', async () => {
    const version = vi.mocked(monopolyBankApi.getGameVersion);
    let fail: (error: Error) => void = () => undefined;
    version.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const { result } = renderSync();
    act(() => result.current.refresh.run());
    expect(result.current.refresh.state).toBe('busy');
    await act(async () => {
      fail(new Error('timed out'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.refresh.state).toBe('error');
    await advance(2000);
    act(() => result.current.refresh.run());
    await advance(0);
    expect(version).toHaveBeenCalledTimes(2);
    expect(result.current.refresh.state).toBe('done');
  });
});
