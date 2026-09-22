// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../shared/contracts/api';
import type { Player } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageContext } from '../i18n/language-context';
import { translate } from '../i18n/translations';
import { GamePage } from './GamePage';

/**
 * The board subsystem is opt-in per game. A game that never chose a board must
 * render exactly the page it rendered before the board UI existed, so the DOM of
 * such a game is pinned by snapshot and every board-only element is asserted
 * absent by its test id.
 */
const boardOnlyTestIds = ['property-panel', 'trade-inbox', 'dice-server-roll', 'net-worth', 'jail-badge', 'jail-bail'];

const players: Player[] = [
  { id: '00000000-0000-4000-8000-000000000101', gameId: 'game-1', name: 'Ada', color: '#d83f55', balance: 1500, status: 'ACTIVE', createdAt: '2026-09-22T10:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000102', gameId: 'game-1', name: 'Bob', color: '#2878d0', balance: 1200, status: 'ACTIVE', createdAt: '2026-09-22T10:00:00.000Z' },
];

const boardlessGame: GameDetails = {
  game: { id: 'game-1', name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z', boardId: null },
  players,
  favoriteAmounts: [],
  recentAmounts: [],
  controlledPlayerIds: [players[0].id],
  controlledWallets: [{ playerId: players[0].id, kind: 'PRIMARY' }],
  canManage: true,
};

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { FakeWebSocket.instances.push(this); }
  send(): void { /* Heartbeats are irrelevant to rendering. */ }
  close(): void { /* The page closes its socket on unmount. */ }
}

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

describe('GamePage for a game without a board', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(monopolyBankApi, 'getGame').mockResolvedValue(boardlessGame);
    vi.spyOn(monopolyBankApi, 'listPaymentRequests').mockResolvedValue([]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderGamePage(): Promise<void> {
    const value = { language: 'en' as const, locale: 'en-US', setLanguage: () => undefined, t: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('en', key, values) };
    await act(async () => {
      root.render(<StrictMode><LanguageContext value={value}><GamePage gameId="game-1" onBack={() => undefined} preferences={{ theme: 'light', sound: false, vibration: false }} offline={false} onPaymentFlowChange={() => undefined} /></LanguageContext></StrictMode>);
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('renders the page exactly as before the board subsystem existed', async () => {
    await renderGamePage();

    expect(container.querySelector('.wallet-grid')).not.toBeNull();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders none of the board-only elements', async () => {
    await renderGamePage();

    for (const testId of boardOnlyTestIds) {
      expect(container.querySelector(`[data-testid="${testId}"]`), testId).toBeNull();
    }
    expect(monopolyBankApi.getGame).toHaveBeenCalledWith('game-1');
  });
});
