import type { Page, Route } from '@playwright/test';

import type { ApiError, ApiSuccess } from '../../shared/contracts/api';
import type { VisualStyleId } from '../../src/appearance/visual-styles';
import type { Language } from '../../src/i18n/translations';
import {
  fixtureActiveGame,
  fixtureActivity,
  fixtureGameDetails,
  fixturePaymentRequests,
  fixturePendingActivity,
  fixtureProfile,
  fixtureSavedGames,
  fixtureStatistics,
  fixtureTransactions,
} from '../fixtures/api';

export type VisualColorMode = 'light' | 'dark';

export interface VisualCase {
  visualStyle: VisualStyleId;
  colorMode: VisualColorMode;
  language: Language;
}

export interface VisualApiOptions {
  /** `false` makes `/api/profile` answer 401 so the app renders `AuthPage`. */
  authenticated?: boolean;
}

/**
 * Puts a fresh page into a deterministic pre-render state: stubbed API, no live socket,
 * fixed appearance and reduced motion. Call before the first `page.goto`.
 */
export async function prepareVisualPage(
  page: Page,
  visualCase: VisualCase,
  options: VisualApiOptions = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: visualCase.colorMode });
  await page.addInitScript(installOfflineWebSocket);
  await page.addInitScript(applyVisualCase, visualCase);
  await mockApi(page, options.authenticated ?? true);
}

/** Runs in the browser before any page script. Must stay self-contained (it is serialized). */
function installOfflineWebSocket(): void {
  class OfflineWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly protocol = '';
    readonly extensions = '';
    readonly bufferedAmount = 0;
    binaryType: BinaryType = 'blob';
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
    }

    /** The socket never opens, so nothing is ever sent and no event is ever dispatched. */
    send(): void {}

    close(): void {
      this.readyState = 3;
    }
  }
  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    writable: true,
    value: OfflineWebSocket,
  });
}

/** Runs in the browser before any page script. Must stay self-contained (it is serialized). */
function applyVisualCase({ visualStyle, colorMode, language }: VisualCase): void {
  // App.tsx re-applies appearance from stored device preferences on mount, so the stored
  // values must agree with the attributes or the first React render would overwrite them.
  try {
    window.localStorage.setItem('monopoly-bank-language', language);
    window.localStorage.setItem(
      'monopoly-bank-device-preferences',
      JSON.stringify({ visualStyle, colorMode, sound: false, vibration: false }),
    );
  } catch {
    /* The initial about:blank document does not expose storage. */
  }
  const apply = () => {
    const root = document.documentElement;
    if (root === null) return;
    root.setAttribute('data-visual-style', visualStyle);
    root.setAttribute('data-color-mode', colorMode);
    root.setAttribute('lang', language);
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply, { once: true });
}

async function mockApi(page: Page, authenticated: boolean): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      await fulfillError(route, 405, 'METHOD_NOT_ALLOWED', 'The visual harness is read-only.');
      return;
    }
    if (url.pathname === '/api/profile' && !authenticated) {
      await fulfillError(route, 401, 'UNAUTHORIZED', 'Sign in to continue.');
      return;
    }
    const data = fixtureFor(url);
    if (data === undefined) {
      await fulfillError(route, 404, 'NOT_FOUND', `No visual fixture for ${url.pathname}.`);
      return;
    }
    await fulfillSuccess(route, data);
  });
}

function fixtureFor(url: URL): unknown {
  const game = `/api/games/${fixtureActiveGame.id}`;
  switch (url.pathname) {
    case '/api/profile':
      return fixtureProfile;
    case '/api/games':
      return fixtureSavedGames;
    case game:
      return fixtureGameDetails;
    case `${game}/payment-requests`:
      return fixturePaymentRequests;
    case `${game}/activity`:
      return url.searchParams.get('scope') === 'PENDING' ? fixturePendingActivity : fixtureActivity;
    case `${game}/summary`:
      return fixtureStatistics;
    case `${game}/transactions`:
      return fixtureTransactions;
    default: {
      const playerHistory = new RegExp(`^${game}/players/([^/]+)/transactions$`).exec(url.pathname);
      if (playerHistory === null) return undefined;
      const playerId = decodeURIComponent(playerHistory[1]);
      return fixtureTransactions.filter((transaction) =>
        transaction.participants.some((participant) => participant.playerId === playerId),
      );
    }
  }
}

async function fulfillSuccess<T>(route: Route, data: T): Promise<void> {
  const body: ApiSuccess<T> = { data };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function fulfillError(
  route: Route,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  const body: ApiError = { error: { code, message } };
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
