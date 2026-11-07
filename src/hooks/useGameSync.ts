import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { GameDetails, PaymentRequest } from '../../shared/contracts/api';
import { isLiveServerEvent, type LiveServerEvent } from '../../shared/contracts/live';
import type { Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { applyLiveEvent, withClientGameDetails } from '../pages/game/game-page-helpers';
import type { LiveStatus } from '../pages/game/GameHeader';
import { acceptsLiveVersion } from '../utils/live-version';

const HEARTBEAT_INTERVAL_MS = 20_000;
const POLL_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 30_000;
const REFRESH_THROTTLE_MS = 2000;
const REFRESH_DONE_MS = 1500;
const CONNECT_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5000;
const MAX_LIVE_TRANSACTIONS = 50;
const PING = 'ping';
const PONG = 'pong';

export type RefreshState = 'idle' | 'busy' | 'done' | 'error';

export interface RefreshControl {
  state: RefreshState;
  run: () => void;
}

type SetDetails = Dispatch<SetStateAction<GameDetails | null>>;

interface SyncState {
  lastVersion: number;
  lastMessageAt: number;
  socket: WebSocket | null;
  inFlight: Promise<void> | null;
  pending: boolean;
}

function initialSync(): SyncState {
  return {
    lastVersion: 0,
    lastMessageAt: Date.now(),
    socket: null,
    inFlight: null,
    pending: false,
  };
}

function liveUrl(gameId: string): URL {
  const url = new URL(`/api/games/${encodeURIComponent(gameId)}/live`, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

function reconnectDelay(attempts: number): number {
  const base = Math.min(1000 * 2 ** (attempts - 1), 10_000);
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

interface LiveListener {
  onStatus: (status: LiveStatus) => void;
  onSocket: (socket: WebSocket | null) => void;
  onOpen: () => void;
  onMessage: (data: unknown) => void;
}

interface Connection {
  closed: boolean;
  retry: number | undefined;
  heartbeat: number | undefined;
  handshake: number | undefined;
  probe: number | undefined;
  socket: WebSocket | null;
  attempts: number;
  lastMessageAt: number;
}

function clearHandshake(state: Connection): void {
  if (state.handshake === undefined) return;
  window.clearTimeout(state.handshake);
  state.handshake = undefined;
}

function clearProbe(state: Connection): void {
  if (state.probe === undefined) return;
  window.clearTimeout(state.probe);
  state.probe = undefined;
}

function clearRetry(state: Connection): void {
  if (state.retry === undefined) return;
  window.clearTimeout(state.retry);
  state.retry = undefined;
}

function stopSocketTimers(state: Connection): void {
  clearHandshake(state);
  clearProbe(state);
  if (state.heartbeat === undefined) return;
  window.clearInterval(state.heartbeat);
  state.heartbeat = undefined;
}

function scheduleRetry(state: Connection, gameId: string, listener: LiveListener): void {
  listener.onStatus('offline');
  state.attempts += 1;
  state.retry = window.setTimeout(() => {
    state.retry = undefined;
    connect(state, gameId, listener);
  }, reconnectDelay(state.attempts));
}

/** Forgets a socket without waiting for its close, which a dead connection can take minutes to report. */
function dropSocket(state: Connection, socket: WebSocket): void {
  stopSocketTimers(state);
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.close();
}

function abandon(
  state: Connection,
  socket: WebSocket,
  gameId: string,
  listener: LiveListener,
): void {
  if (state.closed || state.socket !== socket) return;
  dropSocket(state, socket);
  scheduleRetry(state, gameId, listener);
}

/** Asks an open socket for a sign of life, because a phone can kill one in the background silently. */
function probe(state: Connection, gameId: string, listener: LiveListener): void {
  const socket = state.socket;
  if (state.closed || socket?.readyState !== WebSocket.OPEN || state.probe !== undefined) return;
  // The time spent asleep says nothing about this socket, so the heartbeat check starts over too.
  state.lastMessageAt = Date.now();
  socket.send(PING);
  state.probe = window.setTimeout(() => {
    state.probe = undefined;
    abandon(state, socket, gameId, listener);
  }, PROBE_TIMEOUT_MS);
}

function connect(state: Connection, gameId: string, listener: LiveListener): void {
  if (state.closed) return;
  listener.onStatus(state.attempts === 0 ? 'connecting' : 'reconnecting');
  const socket = new WebSocket(liveUrl(gameId));
  state.socket = socket;
  listener.onSocket(socket);
  state.handshake = window.setTimeout(() => {
    state.handshake = undefined;
    abandon(state, socket, gameId, listener);
  }, CONNECT_TIMEOUT_MS);
  socket.onopen = () => {
    if (state.socket !== socket) return;
    clearHandshake(state);
    state.lastMessageAt = Date.now();
    listener.onStatus('live');
    state.heartbeat = window.setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - state.lastMessageAt > STALE_AFTER_MS
      ) {
        abandon(state, socket, gameId, listener);
        return;
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(PING);
    }, HEARTBEAT_INTERVAL_MS);
    listener.onOpen();
  };
  socket.onmessage = (message) => {
    if (state.socket !== socket) return;
    // Only a message proves the connection works. A socket that opens and dies at once keeps
    // backing off, since every attempt reads the game and tells all the other players.
    state.attempts = 0;
    state.lastMessageAt = Date.now();
    clearProbe(state);
    listener.onMessage(message.data);
  };
  socket.onclose = () => {
    if (state.closed || state.socket !== socket) return;
    stopSocketTimers(state);
    scheduleRetry(state, gameId, listener);
  };
  socket.onerror = () => abandon(state, socket, gameId, listener);
}

function startLiveConnection(
  gameId: string,
  listener: LiveListener,
): { stop: () => void; reconnectNow: () => void; probe: () => void } {
  const state: Connection = {
    closed: false,
    retry: undefined,
    heartbeat: undefined,
    handshake: undefined,
    probe: undefined,
    socket: null,
    attempts: 0,
    lastMessageAt: Date.now(),
  };
  connect(state, gameId, listener);
  return {
    stop: () => {
      state.closed = true;
      clearRetry(state);
      stopSocketTimers(state);
      state.socket?.close();
      listener.onSocket(null);
    },
    probe: () => probe(state, gameId, listener),
    // An open socket only has to prove itself; anything else starts over without the backoff wait.
    reconnectNow: () => {
      if (state.closed) return;
      if (state.socket?.readyState === WebSocket.OPEN) {
        probe(state, gameId, listener);
        return;
      }
      if (state.socket !== null) dropSocket(state, state.socket);
      clearRetry(state);
      connect(state, gameId, listener);
    },
  };
}

function isHealthy(sync: SyncState): boolean {
  return (
    sync.socket !== null &&
    sync.socket.readyState === WebSocket.OPEN &&
    Date.now() - sync.lastMessageAt <= STALE_AFTER_MS
  );
}

function useRefresh(resync: () => Promise<void>): RefreshControl {
  const [state, setState] = useState<RefreshState>('idle');
  const lastRequestAt = useRef(0);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );
  const run = useCallback(() => {
    const now = Date.now();
    if (busy.current || now - lastRequestAt.current < REFRESH_THROTTLE_MS) return;
    lastRequestAt.current = now;
    busy.current = true;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setState('busy');
    void resync().then(
      () => {
        busy.current = false;
        setState('done');
        timer.current = window.setTimeout(() => setState('idle'), REFRESH_DONE_MS);
      },
      () => {
        busy.current = false;
        setState('error');
      },
    );
  }, [resync]);
  return { state, run };
}

interface Options {
  gameId: string;
  enabled: boolean;
  setDetails: SetDetails;
  setLiveTransactions: Dispatch<SetStateAction<Transaction[]>>;
  setPaymentRequests: Dispatch<SetStateAction<PaymentRequest[]>>;
  loadPaymentRequests: () => void;
}

export function useGameSync({
  gameId,
  enabled,
  setDetails,
  setLiveTransactions,
  setPaymentRequests,
  loadPaymentRequests,
}: Options): { liveStatus: LiveStatus; refresh: RefreshControl } {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const sync = useRef<SyncState>(initialSync());
  const reconnectNow = useRef<() => void>(() => undefined);
  const probeSocket = useRef<() => void>(() => undefined);
  const resync = useCallback((): Promise<void> => {
    const current = sync.current;
    if (current.inFlight !== null) {
      current.pending = true;
      return current.inFlight;
    }
    const run = async () => {
      const { stateVersion } = await monopolyBankApi.getGameVersion(gameId);
      if (stateVersion === current.lastVersion) return;
      if (stateVersion < current.lastVersion) {
        current.socket?.close();
        return;
      }
      const game = await monopolyBankApi.getGame(gameId);
      const active = game.game.status === 'ACTIVE';
      const [tradeRequests, paymentRequests] = active
        ? await Promise.all([
            monopolyBankApi.listTradeRequests(gameId),
            monopolyBankApi.listPaymentRequests(gameId),
          ])
        : [undefined, undefined];
      if (current.lastVersion > stateVersion) return;
      setDetails((previous) =>
        withClientGameDetails(
          tradeRequests === undefined ? game : { ...game, tradeRequests },
          previous,
        ),
      );
      if (paymentRequests !== undefined) setPaymentRequests(paymentRequests);
      current.lastVersion = stateVersion;
    };
    const loop = async () => {
      do {
        current.pending = false;
        await run();
      } while (current.pending);
    };
    const flight = loop().finally(() => {
      current.inFlight = null;
      current.pending = false;
    });
    current.inFlight = flight;
    return flight;
  }, [gameId, setDetails, setPaymentRequests]);
  const { state: refreshState, run: runRefresh } = useRefresh(resync);
  // A manual refresh also skips the reconnect backoff, so it doubles as "retry now".
  const refresh: RefreshControl = {
    state: refreshState,
    run: () => {
      reconnectNow.current();
      runRefresh();
    },
  };
  useEffect(() => {
    if (!enabled) return;
    sync.current = initialSync();
    const requestResync = () => void resync().catch(() => undefined);
    const loadTradeRequests = () =>
      void monopolyBankApi.listTradeRequests(gameId).then(
        (tradeRequests) =>
          setDetails((current) => (current === null ? current : { ...current, tradeRequests })),
        () => undefined,
      );
    const handleEvent = (event: LiveServerEvent) => {
      const state = sync.current;
      if (event.type === 'GAME_SNAPSHOT') {
        state.lastVersion = event.state.stateVersion;
        applyLiveEvent(event, setDetails);
        return;
      }
      if (event.type === 'PRESENCE_UPDATED' || event.type === 'HEARTBEAT') {
        if (event.stateVersion > state.lastVersion) requestResync();
        return;
      }
      if (!acceptsLiveVersion(state.lastVersion, event.stateVersion)) {
        requestResync();
        return;
      }
      state.lastVersion = Math.max(state.lastVersion, event.stateVersion);
      applyLiveEvent(event, setDetails);
      if (event.type === 'GAME_COMMITTED') {
        const { transaction } = event;
        setLiveTransactions((current) =>
          [transaction, ...current.filter((item) => item.id !== transaction.id)].slice(
            0,
            MAX_LIVE_TRANSACTIONS,
          ),
        );
      }
      if (event.type === 'PAYMENT_REQUESTS_UPDATED') loadPaymentRequests();
      if (event.type === 'TRADE_REQUESTS_UPDATED') loadTradeRequests();
    };
    const onMessage = (data: unknown) => {
      sync.current.lastMessageAt = Date.now();
      if (data === PONG) return;
      try {
        const event: unknown = JSON.parse(String(data));
        if (isLiveServerEvent(event)) handleEvent(event);
        else requestResync();
      } catch {
        requestResync();
      }
    };
    const onOpen = () => {
      sync.current.lastMessageAt = Date.now();
      requestResync();
    };
    const onResume = () => {
      probeSocket.current();
      requestResync();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onResume();
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || isHealthy(sync.current)) return;
      requestResync();
    }, POLL_INTERVAL_MS);
    const onOnline = () => {
      reconnectNow.current();
      requestResync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onResume);
    const onSocket = (socket: WebSocket | null) => {
      sync.current.socket = socket;
    };
    const connection = startLiveConnection(gameId, {
      onStatus: setLiveStatus,
      onSocket,
      onOpen,
      onMessage,
    });
    reconnectNow.current = connection.reconnectNow;
    probeSocket.current = connection.probe;
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onResume);
      reconnectNow.current = () => undefined;
      probeSocket.current = () => undefined;
      connection.stop();
    };
  }, [gameId, enabled, resync, setDetails, setLiveTransactions, loadPaymentRequests]);
  return { liveStatus, refresh };
}
