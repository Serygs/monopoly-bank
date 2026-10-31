import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerStatistics } from '../../shared/contracts/api';
import type { Player } from '../../shared/types/monopoly';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { StatisticsScreen } from './StatisticsScreen';

const player = (id: string, name: string, balance: number): Player => ({
  id,
  gameId: 'g',
  name,
  color: id === 'a' ? '#d83f55' : '#2878d0',
  balance,
  status: 'ACTIVE',
  createdAt: '',
});
const ada = player('a', 'Ada', 1400);
const bo = player('b', 'Bo', 1600);

const summary = {
  winners: [bo],
  durationMs: 0,
  totalTransactions: 2,
  totalMoneyTransferred: 500,
  largestSinglePayment: 300,
  richestActivePlayer: bo,
  lowestActiveBalance: 1400,
  players: [],
  playerToPlayerTotal: 300,
  paidToBank: 0,
  receivedFromBank: 200,
  largestTransaction: 300,
  biggestSenderId: 'a',
  leastSenderId: 'b',
  biggestPayerRecipient: null,
  cashLeaderboard: [
    { player: bo, sent: 0, received: 300, passGoCount: 0, transactionCount: 1 },
    { player: ada, sent: 300, received: 200, passGoCount: 1, transactionCount: 2 },
  ],
  awards: {
    biggestOperation: { type: 'PLAYER_TO_PLAYER', amount: 300, playerId: 'a' },
    rentPaid: { playerId: 'a', amount: 300 },
    rentCollected: { playerId: 'b', amount: 300 },
    bestAuctionDeal: { playerId: 'b', amount: 120, label: 'Park Lane' },
    biggestLoan: null,
  },
  balanceSeries: {
    steps: 2,
    players: [
      { playerId: 'a', balances: [1500, 1200, 1400] },
      { playerId: 'b', balances: [1500, 1800, 1800] },
    ],
  },
} satisfies { winners: Player[] } & LedgerStatistics;

function renderScreen(finished: boolean, data: typeof summary | Omit<typeof summary, 'awards'>) {
  render(
    <LanguageProvider>
      <StatisticsScreen
        summary={data as typeof summary}
        currency="USD"
        finished={finished}
        onClose={() => {}}
      />
    </LanguageProvider>,
  );
}

describe('StatisticsScreen', () => {
  it('hides the winners block while the game is active', () => {
    renderScreen(false, summary);
    expect(screen.queryByText('Winners')).toBeNull();
  });

  it('shows the winners and a final summary once the game is finished', () => {
    renderScreen(true, summary);
    expect(screen.getByText('Winners')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final summary' })).toBeInTheDocument();
  });

  it('lists award cards, including the most GO passes, and skips empty ones', () => {
    renderScreen(false, summary);
    const awards = within(screen.getByTestId('awards'));
    expect(awards.getByText('Most GO passes')).toBeInTheDocument();
    expect(awards.getByText('Best auction deal')).toBeInTheDocument();
    expect(awards.getByText(/Park Lane/)).toBeInTheDocument();
    expect(awards.queryByText('Biggest loan')).toBeNull();
  });

  it('offers the balance chart with a table fallback', () => {
    renderScreen(false, summary);
    expect(screen.getByRole('img', { name: /2 operations/ })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('columnheader', { name: 'Ada' })).toBeInTheDocument();
  });

  it('picks one line out from the legend and ends a bankrupt line with a mark', () => {
    const bankrupt = {
      ...summary,
      balanceSeries: {
        steps: 2,
        players: [
          { playerId: 'a', balances: [1500, 0, 0], endIndex: 1 },
          { playerId: 'b', balances: [1500, 1800, 1800] },
        ],
      },
    };
    renderScreen(false, bankrupt);
    const legend = screen.getByRole('button', { name: /Ada/ });
    expect(legend).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(legend);
    expect(legend).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(legend);
    expect(legend).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img', { name: /2 operations/ }).textContent).toContain('✕');
  });

  it('still renders a snapshot saved before awards existed', () => {
    const { awards: _awards, balanceSeries: _series, ...legacy } = summary;
    renderScreen(true, legacy as typeof summary);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Most GO passes')).toBeInTheDocument();
  });
});

describe('StatisticsScreen without winners', () => {
  it('says there is no winner when the game finished without naming one', () => {
    renderScreen(true, { ...summary, winners: [] });
    expect(screen.getByRole('heading', { level: 3, name: 'No winner' })).toBeInTheDocument();
    expect(screen.getByText('Winners')).toBeInTheDocument();
  });

  it('names every winner, comma separated, when there are several', () => {
    renderScreen(true, { ...summary, winners: [ada, bo] });
    expect(screen.getByRole('heading', { level: 3, name: 'Ada, Bo' })).toBeInTheDocument();
    expect(screen.queryByText('No winner')).toBeNull();
  });

  it('shows the plain statistics heading, and never the no-winner text, while the game runs', () => {
    renderScreen(false, { ...summary, winners: [] });
    expect(screen.queryByText('No winner')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Statistics' })).toBeInTheDocument();
  });
});

describe('StatisticsScreen pull to refresh', () => {
  it('calls the refresh handler after a pull from the top', () => {
    const onPullRefresh = vi.fn();
    render(
      <LanguageProvider>
        <StatisticsScreen
          summary={summary}
          currency="USD"
          onPullRefresh={onPullRefresh}
          onClose={() => {}}
        />
      </LanguageProvider>,
    );
    const panel = document.querySelector('.dialog');
    if (panel === null) throw new Error('missing panel');
    fireEvent.touchStart(panel, { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchMove(panel, { touches: [{ clientX: 0, clientY: 150 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 0, clientY: 0 }] });
    expect(onPullRefresh).toHaveBeenCalledTimes(1);
  });
});
