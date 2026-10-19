import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate, type Language } from '../i18n/translations';
import { ActivityScreen } from './ActivityScreen';

function renderActivity(
  language: Language,
  showPending = true,
  extra: Partial<React.ComponentProps<typeof ActivityScreen>> = {},
  players: Player[] = [],
) {
  return render(
    <LanguageContext
      value={{
        language,
        locale: languageLocale(language),
        setLanguage: () => {},
        t: (key, values) => translate(language, key, values),
      }}
    >
      <ActivityScreen
        gameId="game-1"
        players={players}
        currency="K"
        liveTransactions={[]}
        showPending={showPending}
        onClose={() => {}}
        {...extra}
      />
    </LanguageContext>,
  );
}

describe('activity accessibility', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [],
      paymentRequests: [],
      nextCursor: null,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits the Pending tab when payments are settled immediately', async () => {
    renderActivity('en', false);
    await screen.findByText(translate('en', 'noActivity'));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      translate('en', 'activityAll'),
      translate('en', 'activityMine'),
    ]);
  });

  it.each(['en', 'uk'] as const)(
    'connects tabs to one keyboard-focusable panel in %s',
    async (language) => {
      renderActivity(language);
      await screen.findByText(translate(language, 'noActivity'));

      expect(screen.getByRole('tablist')).toBeInTheDocument();
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      expect(tabs.filter((tab) => tab.hasAttribute('aria-controls'))).toHaveLength(3);
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '-1')).toHaveLength(2);

      const panel = screen.getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toMatch(/.+/);
      expect(panel).toHaveAttribute('tabindex', '0');
    },
  );

  it('moves selection between tabs with the arrow, Home and End keys', async () => {
    const user = userEvent.setup();
    renderActivity('en');
    await screen.findByText(translate('en', 'noActivity'));

    const allTab = screen.getByRole('tab', { name: translate('en', 'activityAll') });
    const mineTab = screen.getByRole('tab', { name: translate('en', 'activityMine') });
    const pendingTab = screen.getByRole('tab', { name: translate('en', 'activityPending') });
    await user.click(allTab);
    expect(allTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(mineTab).toHaveFocus();
    expect(mineTab).toHaveAttribute('aria-selected', 'true');
    expect(allTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', mineTab.id);

    await user.keyboard('{End}');
    expect(pendingTab).toHaveFocus();
    expect(pendingTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(pendingTab).toHaveFocus();

    await user.keyboard('{Home}');
    expect(allTab).toHaveFocus();
    expect(screen.getAllByRole('tab', { selected: true })).toEqual([allTab]);
    await screen.findByText(translate('en', 'noActivity'));
  });
});

describe('reverting from the activity ledger', () => {
  const player = (id: string, name: string): Player => ({
    id,
    gameId: 'game-1',
    name,
    color: '#000',
    balance: 1000,
    status: 'ACTIVE',
    createdAt: '',
  });
  const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
    id,
    gameId: 'game-1',
    type: 'PLAYER_TO_PLAYER',
    amount: 50,
    totalAmount: 50,
    comment: null,
    createdAt: new Date().toISOString(),
    participants: [
      { playerId: 'a', balanceDelta: -50 },
      { playerId: 'b', balanceDelta: 50 },
    ],
    ...extra,
  });
  const players = [player('a', 'Ada'), player('b', 'Bo')];
  const reversal = (onReverse = vi.fn()) => ({
    isOwner: false,
    controlledPlayerIds: ['a'],
    onReverse,
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers Reverse on the own operation of the viewer in both All and Mine, and nowhere else', async () => {
    const user = userEvent.setup();
    const own = tx('own');
    const other = tx('other', {
      participants: [
        { playerId: 'b', balanceDelta: -50 },
        { playerId: 'a', balanceDelta: 50 },
      ],
    });
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [own, other],
      paymentRequests: [],
      nextCursor: null,
    });
    const onReverse = vi.fn();
    renderActivity('en', false, { reversal: reversal(onReverse) }, players);

    const buttons = await screen.findAllByRole('button', { name: 'Reverse' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);
    expect(onReverse).toHaveBeenCalledWith(own);

    await user.click(screen.getByRole('tab', { name: translate('en', 'activityMine') }));
    expect(await screen.findAllByRole('button', { name: 'Reverse' })).toHaveLength(1);
  });

  it('explains why an operation cannot be reversed: a later mortgage, or the time window', async () => {
    const old = tx('old', { createdAt: '2020-01-01T10:00:00.000Z' });
    const paid = tx('paid');
    const mortgage = tx('m', {
      type: 'MORTGAGE',
      participants: [{ playerId: 'b', balanceDelta: 100 }],
    });
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [mortgage, paid, old],
      paymentRequests: [],
      nextCursor: null,
    });
    renderActivity('en', false, { reversal: reversal() }, players);

    expect(await screen.findAllByText(/Cannot be reversed/)).toHaveLength(2);
    expect(screen.getByText(translate('en', 'reversalBlockedLater'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
  });

  it('marks the original as reversed when the reversal arrives live', async () => {
    const own = tx('own');
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [own],
      paymentRequests: [],
      nextCursor: null,
    });
    const live = tx('rev', {
      type: 'REVERSAL',
      reversesTransactionId: 'own',
      participants: [
        { playerId: 'a', balanceDelta: 50 },
        { playerId: 'b', balanceDelta: -50 },
      ],
    });
    renderActivity('en', false, { liveTransactions: [live], reversal: reversal() }, players);

    expect(await screen.findByText(translate('en', 'reversedBadge'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).toBeNull();
  });
});

describe('activity player filter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const wallet = (id: string, name: string): Player => ({
    id,
    gameId: 'game-1',
    name,
    color: '#000',
    balance: 0,
    status: 'ACTIVE',
    createdAt: '',
  });
  const ledgerEntry = (id: string, playerId: string): Transaction => ({
    id,
    gameId: 'game-1',
    type: 'PLAYER_TO_BANK',
    amount: 5,
    totalAmount: 5,
    comment: `note-${id}`,
    createdAt: '2026-01-01T10:00:00.000Z',
    participants: [{ playerId, balanceDelta: -5 }],
  });

  it('narrows the ledger to one wallet and clears on request', async () => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [ledgerEntry('t1', 'a'), ledgerEntry('t2', 'b')],
      paymentRequests: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderActivity('en', true, { initialPlayerId: 'a' }, [wallet('a', 'Ada'), wallet('b', 'Bo')]);
    expect(await screen.findByText('note-t1')).toBeInTheDocument();
    expect(screen.queryByText('note-t2')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show everyone instead of Ada' }));
    expect(await screen.findByText('note-t2')).toBeInTheDocument();
  });
});

describe('activity empty states', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [],
      paymentRequests: [],
      nextCursor: null,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says there is no activity in All and Mine, and no pending activity in Pending', async () => {
    const user = userEvent.setup();
    renderActivity('en', true);
    expect(await screen.findByText(translate('en', 'noActivity'))).toBeInTheDocument();
    expect(screen.queryByText(translate('en', 'noPendingActivity'))).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: translate('en', 'activityMine') }));
    expect(await screen.findByText(translate('en', 'noActivity'))).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: translate('en', 'activityPending') }));
    expect(await screen.findByText(translate('en', 'noPendingActivity'))).toBeInTheDocument();
    expect(screen.queryByText(translate('en', 'noActivity'))).not.toBeInTheDocument();
  });

  it('words the empty states in Ukrainian', async () => {
    const user = userEvent.setup();
    renderActivity('uk', true);
    expect(await screen.findByText(translate('uk', 'noActivity'))).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: translate('uk', 'activityPending') }));
    expect(await screen.findByText(translate('uk', 'noPendingActivity'))).toBeInTheDocument();
    expect(translate('uk', 'noPendingActivity')).not.toBe(translate('en', 'noPendingActivity'));
  });
});

describe('activity filtered by one player', () => {
  const tx = (id: string, playerIds: string[], extra: Partial<Transaction> = {}): Transaction => ({
    id,
    gameId: 'game-1',
    type: 'PLAYER_TO_PLAYER',
    amount: 10,
    totalAmount: 10,
    comment: `note-${id}`,
    createdAt: '2026-01-01T10:00:00.000Z',
    participants: playerIds.map((playerId, index) => ({
      playerId,
      balanceDelta: index === 0 ? -10 : 10,
    })),
    ...extra,
  });
  const players: Player[] = ['p1', 'p2', 'p3'].map((id) => ({
    id,
    gameId: 'game-1',
    name: `Name-${id}`,
    color: '#000',
    balance: 0,
    createdAt: '',
  }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows only the rows the player is a participant of, and not those they merely started', async () => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [
        tx('with-p1', ['p1', 'p2']),
        tx('without-p1', ['p2', 'p3']),
        tx('initiated-only', ['p2', 'p3'], { initiatorPlayerId: 'p1' }),
        tx('zero-delta', ['p3'], {
          participants: [{ playerId: 'p1', balanceDelta: 0 }],
        }),
      ],
      paymentRequests: [],
      nextCursor: null,
    });
    renderActivity('en', true, { initialPlayerId: 'p1' }, players);
    expect(await screen.findByText(/note-with-p1/u)).toBeInTheDocument();
    expect(screen.getByText(/note-zero-delta/u)).toBeInTheDocument();
    expect(screen.queryByText(/note-without-p1/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/note-initiated-only/u)).not.toBeInTheDocument();
  });

  it('shows every row when no player is chosen', async () => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [tx('one', ['p1', 'p2']), tx('two', ['p2', 'p3'])],
      paymentRequests: [],
      nextCursor: null,
    });
    renderActivity('en', true, {}, players);
    expect(await screen.findByText(/note-one/u)).toBeInTheDocument();
    expect(screen.getByText(/note-two/u)).toBeInTheDocument();
  });

  it('says there is nothing for a player who took part in nothing', async () => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [tx('one', ['p2', 'p3'])],
      paymentRequests: [],
      nextCursor: null,
    });
    renderActivity('en', true, { initialPlayerId: 'p1' }, players);
    expect(await screen.findByText(translate('en', 'noActivity'))).toBeInTheDocument();
    expect(screen.queryByText(/note-one/u)).not.toBeInTheDocument();
  });
});

describe('activity pull to refresh', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [],
      paymentRequests: [],
      nextCursor: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the refresh handler after a pull from the top', async () => {
    const onPullRefresh = vi.fn();
    renderActivity('en', true, { onPullRefresh });
    const panel = document.querySelector('.dialog');
    if (panel === null) throw new Error('missing panel');
    fireEvent.touchStart(panel, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientX: 0, clientY: 150 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 0, clientY: 0 }] });
    expect(onPullRefresh).toHaveBeenCalledTimes(1);
    await screen.findByRole('tablist');
  });
});
