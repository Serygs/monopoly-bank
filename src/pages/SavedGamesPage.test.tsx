import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeletedGameSummary, GameSummary } from '../../shared/contracts/api';
import { defaultGameRules, type Game } from '../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { FeedbackProvider } from '../components/ui';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { SavedGamesPage } from './SavedGamesPage';

function game(id: string, name: string, status: Game['status'] = 'ACTIVE'): Game {
  return {
    id,
    name,
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
}

const friday: GameSummary = { game: game('g1', 'Friday Game'), playerCount: 3 };
const deleted: DeletedGameSummary = {
  game: game('g2', 'Old Table', 'FINISHED'),
  playerCount: 4,
  deletedAt: '2026-10-10T10:00:00.000Z',
  purgeAt: '2026-11-09T10:00:00.000Z',
};

const handlers = {
  onCreateGame: vi.fn(),
  onJoinGame: vi.fn(),
  onOpenGame: vi.fn(),
};

function setup(games: GameSummary[], deletedGames: DeletedGameSummary[]) {
  vi.spyOn(monopolyBankApi, 'listGames').mockResolvedValue(games);
  vi.spyOn(monopolyBankApi, 'listDeletedGames').mockResolvedValue(deletedGames);
  render(
    <LanguageProvider>
      <FeedbackProvider>
        <SavedGamesPage {...handlers} />
      </FeedbackProvider>
    </LanguageProvider>,
  );
  return userEvent.setup();
}

describe('SavedGamesPage deleted games', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps deleted games out of the normal list and offers them under Deleted', async () => {
    const user = setup([friday], [deleted]);
    await screen.findByText('Friday Game');
    expect(screen.queryByText('Old Table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Deleted' }));

    const section = screen.getByRole('region', { name: 'Deleted' });
    expect(within(section).getByText('Old Table')).toBeInTheDocument();
    expect(within(section).getByText('Finished')).toBeInTheDocument();
    expect(within(section).getByText(/restorable until/i)).toBeInTheDocument();
    expect(screen.queryByText('Friday Game')).not.toBeInTheDocument();
  });

  it('does not show a Deleted filter when nothing was deleted', async () => {
    setup([friday], []);
    await screen.findByText('Friday Game');
    expect(screen.queryByRole('radio', { name: 'Deleted' })).not.toBeInTheDocument();
  });

  it('restores a deleted game back into the saved games', async () => {
    const restore = vi.spyOn(monopolyBankApi, 'restoreGame').mockResolvedValue({ gameId: 'g2' });
    const user = setup([friday], [deleted]);
    await screen.findByText('Friday Game');
    await user.click(screen.getByRole('radio', { name: 'Deleted' }));

    vi.mocked(monopolyBankApi.listGames).mockResolvedValue([friday, { ...deleted }]);
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith('g2'));
    expect(await screen.findByText('Old Table was restored.')).toBeInTheDocument();
    expect(screen.getByText('No deleted games.')).toBeInTheDocument();
  });

  it('reaches Deleted even when every game has been deleted', async () => {
    const user = setup([], [deleted]);
    await user.click(await screen.findByRole('radio', { name: 'Deleted' }));
    expect(screen.getByText('Old Table')).toBeInTheDocument();
  });

  it('keeps the same meta lines on every card and adds the time only to games that share a name', async () => {
    const twin: GameSummary = { game: game('g3', 'Friday Game'), playerCount: 2 };
    const other: GameSummary = { game: game('g4', 'Sunday Game'), playerCount: 2 };
    setup([friday, twin, other], []);
    await screen.findAllByText('Friday Game');
    expect(screen.queryAllByText(/^Created /)).toHaveLength(0);
    const updated = screen.getAllByText(/^Updated /);
    expect(updated).toHaveLength(3);
    expect(updated.filter((line) => /\d:\d\d/.test(line.textContent ?? ''))).toHaveLength(2);
  });
});

describe('SavedGamesPage empty state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invites the user to create the first game when there is nothing saved or deleted', async () => {
    const user = setup([], []);
    expect(await screen.findByText('No saved games yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create new game' }));
    expect(handlers.onCreateGame).toHaveBeenCalledTimes(1);
  });

  it('shows no empty state while the list is loading, after an error or once a game exists', async () => {
    vi.spyOn(monopolyBankApi, 'listGames').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(monopolyBankApi, 'listDeletedGames').mockReturnValue(new Promise(() => undefined));
    const loading = render(
      <LanguageProvider>
        <FeedbackProvider>
          <SavedGamesPage {...handlers} />
        </FeedbackProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByText('No saved games yet')).not.toBeInTheDocument();
    loading.unmount();
    vi.restoreAllMocks();
    vi.spyOn(monopolyBankApi, 'listGames').mockRejectedValue(
      new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'x' }),
    );
    vi.spyOn(monopolyBankApi, 'listDeletedGames').mockResolvedValue([]);
    render(
      <LanguageProvider>
        <FeedbackProvider>
          <SavedGamesPage {...handlers} />
        </FeedbackProvider>
      </LanguageProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('No saved games yet')).not.toBeInTheDocument();
  });

  it('shows the games, not the empty state, once there is one', async () => {
    setup([friday], []);
    await screen.findByText('Friday Game');
    expect(screen.queryByText('No saved games yet')).not.toBeInTheDocument();
  });
});
