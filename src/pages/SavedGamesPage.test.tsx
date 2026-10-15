import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeletedGameSummary, GameSummary } from '../../shared/contracts/api';
import type { Game } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
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

function setup(games: GameSummary[], deletedGames: DeletedGameSummary[]) {
  vi.spyOn(monopolyBankApi, 'listGames').mockResolvedValue(games);
  vi.spyOn(monopolyBankApi, 'listDeletedGames').mockResolvedValue(deletedGames);
  render(
    <LanguageProvider>
      <FeedbackProvider>
        <SavedGamesPage onCreateGame={vi.fn()} onJoinGame={vi.fn()} onOpenGame={vi.fn()} />
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
});
