import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GameDetails } from '../../shared/contracts/api';
import { isLiveServerEvent, type LiveServerEvent } from '../../shared/contracts/live';
import type { Transaction } from '../../shared/types/monopoly';
import { applyLiveEvent } from '../pages/game/game-page-helpers';
import type { LiveStatus } from '../pages/game/GameHeader';
import { acceptsLiveVersion } from '../utils/live-version';

const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_LIVE_TRANSACTIONS = 50;
const VERSION_GAP_CLOSE_CODE = 4001;

interface LiveListener {
  onStatus: (status: LiveStatus) => void;
  onEvent: (event: LiveServerEvent, socket: WebSocket) => void;
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

function startHeartbeat(socket: WebSocket): number {
  return window.setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
  }, HEARTBEAT_INTERVAL_MS);
}

function deliver(data: unknown, socket: WebSocket, listener: LiveListener): void {
  try {
    const event: unknown = JSON.parse(String(data));
    if (isLiveServerEvent(event)) listener.onEvent(event, socket);
  } catch {
    return;
  }
}

function startLiveConnection(gameId: string, listener: LiveListener): () => void {
  let closed = false;
  let retry: number | undefined;
  let heartbeat: number | undefined;
  let socket: WebSocket | null = null;
  let attempts = 0;
  const stopHeartbeat = () => {
    if (heartbeat === undefined) return;
    window.clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const connect = () => {
    if (closed) return;
    listener.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    const nextSocket = new WebSocket(liveUrl(gameId));
    socket = nextSocket;
    nextSocket.onopen = () => {
      if (socket !== nextSocket) return;
      attempts = 0;
      listener.onStatus('live');
      heartbeat = startHeartbeat(nextSocket);
    };
    nextSocket.onmessage = (message) => {
      if (socket === nextSocket) deliver(message.data, nextSocket, listener);
    };
    nextSocket.onclose = () => {
      stopHeartbeat();
      if (closed || socket !== nextSocket) return;
      listener.onStatus('offline');
      attempts += 1;
      retry = window.setTimeout(connect, reconnectDelay(attempts));
    };
    nextSocket.onerror = () => {
      if (socket === nextSocket) nextSocket.close();
    };
  };
  connect();
  return () => {
    closed = true;
    if (retry !== undefined) window.clearTimeout(retry);
    stopHeartbeat();
    socket?.close();
  };
}

interface Options {
  gameId: string;
  enabled: boolean;
  setDetails: Dispatch<SetStateAction<GameDetails | null>>;
  setLiveTransactions: Dispatch<SetStateAction<Transaction[]>>;
  loadPaymentRequests: () => void;
}

export function useGameLiveConnection({
  gameId,
  enabled,
  setDetails,
  setLiveTransactions,
  loadPaymentRequests,
}: Options): LiveStatus {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const lastAppliedVersion = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const handleEvent = (event: LiveServerEvent, socket: WebSocket) => {
      if (event.type === 'GAME_SNAPSHOT') {
        lastAppliedVersion.current = event.state.stateVersion;
        applyLiveEvent(event, setDetails);
        return;
      }
      if (!acceptsLiveVersion(lastAppliedVersion.current, event.stateVersion)) {
        socket.close(VERSION_GAP_CLOSE_CODE, 'State version gap: resync required.');
        return;
      }
      lastAppliedVersion.current = Math.max(lastAppliedVersion.current, event.stateVersion);
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
    };
    return startLiveConnection(gameId, { onStatus: setLiveStatus, onEvent: handleEvent });
  }, [gameId, enabled, setDetails, setLiveTransactions, loadPaymentRequests]);
  return liveStatus;
}
