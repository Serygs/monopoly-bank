import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('still renders a snapshot saved before awards existed', () => {
    const { awards: _awards, balanceSeries: _series, ...legacy } = summary;
    renderScreen(true, legacy as typeof summary);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Most GO passes')).toBeInTheDocument();
  });
});
