// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails, PropertyOperationResponse } from '../../shared/contracts/api';
import type { LiveServerEvent } from '../../shared/contracts/live';
import { netWorth } from '../../shared/domain/net-worth';
import type { BoardDefinition, BoardSpace, GameProperty, Player, Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageContext } from '../i18n/language-context';
import { translate } from '../i18n/translations';
import { GamePage } from './GamePage';

const board: BoardDefinition = { id: 'board-classic', name: 'Classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 };
const spaces: BoardSpace[] = [
  { id: 'board-classic-space-01', boardIndex: 1, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'boardSpaceMediterraneanAvenue', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { id: 'board-classic-space-03', boardIndex: 3, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'boardSpaceBalticAvenue', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { id: 'board-classic-space-39', boardIndex: 39, kind: 'STREET', colorGroup: 'DARK_BLUE', translationKey: 'boardSpaceBoardwalk', customName: null, price: 400, mortgageValue: 200, houseCost: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];
const players: Player[] = [
  { id: '00000000-0000-4000-8000-000000000101', gameId: 'game-1', name: 'Ada', color: '#d83f55', balance: 1500, status: 'ACTIVE', isInJail: false, consecutiveDoubles: 0, lastRollTotal: null, createdAt: '2026-09-22T10:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000102', gameId: 'game-1', name: 'Bob', color: '#2878d0', balance: 1200, status: 'ACTIVE', isInJail: false, consecutiveDoubles: 0, lastRollTotal: null, createdAt: '2026-09-22T10:00:00.000Z' },
];
const freeProperties: GameProperty[] = spaces.map((space) => ({ boardSpaceId: space.id, ownerPlayerId: null, houses: 0, mortgaged: false }));
const boardGame: GameDetails = {
  game: { id: 'game-1', name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z', boardId: board.id },
  players,
  favoriteAmounts: [],
  recentAmounts: [],
  controlledPlayerIds: [players[0].id],
  controlledWallets: [{ playerId: players[0].id, kind: 'PRIMARY' }],
  canManage: true,
  board,
  boardSpaces: spaces,
  properties: freeProperties,
  buildingBank: { housesAvailable: 32, hotelsAvailable: 12 },
};
const purchaseTransaction: Transaction = { id: 'tx-1', gameId: 'game-1', type: 'PROPERTY_PURCHASE', amount: 60, totalAmount: 60, comment: null, createdAt: '2026-09-22T10:05:00.000Z', participants: [{ playerId: players[0].id, balanceDelta: -60 }] };

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: URL;
  constructor(url: URL) { this.url = url; FakeWebSocket.instances.push(this); }
  send(): void { /* Heartbeats are irrelevant here. */ }
  close(): void { /* Closed on unmount. */ }
  receive(event: LiveServerEvent): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

describe('GamePage for a game on a board', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.spyOn(monopolyBankApi, 'getGame').mockResolvedValue(boardGame);
    vi.spyOn(monopolyBankApi, 'listPaymentRequests').mockResolvedValue([]);
    vi.spyOn(monopolyBankApi, 'listTrades').mockResolvedValue([]);
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

  const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); }); };
  const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
  const chip = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="property-panel"] .deed-chip-button')].find((button) => button.getAttribute('aria-label')?.startsWith(name)) ?? null;

  it('renders the property panel, the trade inbox, the roll recorder and capital on every wallet', async () => {
    await renderGamePage();

    expect(byTestId('property-panel')).not.toBeNull();
    expect(byTestId('trade-inbox')).not.toBeNull();
    expect(byTestId('dice-server-roll')).not.toBeNull();
    const capital = [...container.querySelectorAll('[data-testid="net-worth"]')].map((node) => node.textContent);
    expect(capital).toEqual([`Net worth $${netWorth(players[0], spaces, freeProperties).toLocaleString('en-US').replace(',', ' ')}`, `Net worth $${netWorth(players[1], spaces, freeProperties).toLocaleString('en-US').replace(',', ' ')}`]);
    expect(monopolyBankApi.listTrades).toHaveBeenCalledWith('game-1');
    expect(container.textContent).toContain('3 free');
    expect(container.textContent).toContain('Mediterranean Avenue');
  });

  it('buys a free deed in two taps and repaints the panel from the response', async () => {
    const owned: GameProperty[] = freeProperties.map((property) => (property.boardSpaceId === spaces[0].id ? { ...property, ownerPlayerId: players[0].id } : property));
    const response: PropertyOperationResponse = { transaction: purchaseTransaction, players: [{ ...players[0], balance: 1440 }, players[1]], properties: owned, buildingBank: boardGame.buildingBank as PropertyOperationResponse['buildingBank'] };
    const purchase = vi.spyOn(monopolyBankApi, 'purchaseProperty').mockResolvedValue(response);
    await renderGamePage();

    await click(chip('Mediterranean Avenue'));
    const buy = container.querySelector<HTMLButtonElement>('[role="dialog"] [data-action="PURCHASE"]');
    expect(buy?.textContent).toBe('Buy for $60');
    expect(container.querySelector('[role="dialog"] [data-action="AUCTION"]')?.textContent).toBe('Auction');
    await click(buy);
    expect(byTestId('space-action-amount')?.textContent).toBe('Amount: $60');
    await click(byTestId('space-action-review'));
    await click(byTestId('space-action-confirm'));

    expect(purchase).toHaveBeenCalledWith('game-1', { boardSpaceId: spaces[0].id, playerId: players[0].id }, expect.any(String));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const adaSection = container.querySelector('[data-testid="property-panel"] .property-owner[aria-label="Ada"]');
    expect(adaSection?.textContent).toContain('Mediterranean Avenue');
    expect(container.textContent).toContain('2 free');
    expect(byTestId('board-notice')?.textContent).toContain('Bought a deed recorded.');
  });

  it('merges the changed deed rows of a GAME_COMMITTED event without a reload', async () => {
    await renderGamePage();
    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    await act(async () => { socket?.receive({ type: 'GAME_SNAPSHOT', state: { stateVersion: 4, details: boardGame, transactions: [] } }); });

    await act(async () => { socket?.receive({ type: 'GAME_COMMITTED', stateVersion: 5, transaction: purchaseTransaction, players: [{ ...players[1], balance: 800 }, players[0]], properties: [{ boardSpaceId: spaces[2].id, ownerPlayerId: players[1].id, houses: 0, mortgaged: false }], buildingBank: { housesAvailable: 31, hotelsAvailable: 12 } }); });

    const bobSection = container.querySelector('[data-testid="property-panel"] .property-owner[aria-label="Bob"]');
    expect(bobSection?.textContent).toContain('Boardwalk');
    expect(container.textContent).toContain('2 free');
    expect(container.textContent).toContain('Bank holds 31 houses');
  });

  it('explains a blocked action with the domain reason and prices rent with calculateRent', async () => {
    const owned: GameProperty[] = freeProperties.map((property) => (property.boardSpaceId === spaces[1].id ? { ...property, ownerPlayerId: players[1].id } : property.boardSpaceId === spaces[0].id ? { ...property, ownerPlayerId: players[0].id } : property));
    vi.spyOn(monopolyBankApi, 'getGame').mockResolvedValue({ ...boardGame, properties: owned });
    await renderGamePage();

    await click(chip('Baltic Avenue'));
    expect(container.querySelector('[role="dialog"] [data-action="PAY_RENT"]')?.textContent).toBe('Pay rent $4');
    await click(container.querySelector('[role="dialog"] .dialog-close'));

    await click(chip('Mediterranean Avenue'));
    const build = container.querySelector<HTMLButtonElement>('[role="dialog"] [data-action="BUILD"]');
    expect(build?.disabled).toBe(true);
    expect(container.querySelector('[role="dialog"] .space-action-reason')?.textContent).toBe('The whole colour group must be owned first.');
    expect(container.querySelector('[role="dialog"] [data-action="MORTGAGE"]')?.textContent).toBe('Mortgage for $30');
  });

  it('shows the jail badge after a third double and clears it when bail is paid', async () => {
    const jailed = { ...players[0], isInJail: true, consecutiveDoubles: 0, lastRollTotal: 8 };
    vi.spyOn(monopolyBankApi, 'recordDiceRoll').mockResolvedValue({ player: jailed, thirdDouble: true });
    vi.spyOn(monopolyBankApi, 'payJailBail').mockResolvedValue({ transaction: { ...purchaseTransaction, id: 'tx-2', type: 'JAIL_BAIL', amount: 50, totalAmount: 50 }, players: [{ ...players[0], isInJail: false, balance: 1450 }, players[1]] });
    await renderGamePage();
    expect(byTestId('jail-badge')).toBeNull();

    await click(container.querySelector('.dice-button'));
    await click(byTestId('dice-server-roll'));

    expect(monopolyBankApi.recordDiceRoll).toHaveBeenCalledWith('game-1', expect.objectContaining({ playerId: players[0].id }));
    expect(byTestId('jail-badge')?.textContent).toBe('In jail');
    expect(byTestId('dice-notice')?.textContent).toContain('Third double — Ada goes to jail!');
    expect(byTestId('jail-bail')?.textContent).toBe('Pay bail ($50)');

    await click(byTestId('jail-bail'));

    expect(monopolyBankApi.payJailBail).toHaveBeenCalledWith('game-1', { playerId: players[0].id });
    expect(byTestId('jail-badge')).toBeNull();
    expect(byTestId('jail-bail')).toBeNull();
  });
});
