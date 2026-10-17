import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { FeedbackProvider } from '../components/ui';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { ProfilePage } from './ProfilePage';

const profile: UserProfile = {
  id: 'u1',
  nickname: 'Olena',
  avatar: 'fox',
  accountType: 'REGISTERED',
  email: 'olena@example.com',
  emailVerified: true,
  gamesPlayed: 10,
  gamesWon: 4,
  gamesLost: 6,
  winRate: 0.4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(onUpdated = vi.fn()) {
  render(
    <LanguageProvider>
      <FeedbackProvider>
        <ProfilePage profile={profile} onUpdated={onUpdated} />
      </FeedbackProvider>
    </LanguageProvider>,
  );
  return { user: userEvent.setup(), onUpdated };
}

afterEach(() => vi.restoreAllMocks());

describe('ProfilePage', () => {
  it('shows the stats in one row and keeps the avatar picker behind a sheet', async () => {
    const { user } = setup();
    expect(screen.getAllByRole('term')).toHaveLength(4);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change avatar' }));
    expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeInTheDocument();
  });

  it('names the page once and keeps the stat labels short', () => {
    setup();
    expect(screen.getAllByText('Player profile')).toHaveLength(1);
    expect(screen.getByText('Played')).toBeInTheDocument();
    expect(screen.getByText('Win rate')).toBeInTheDocument();
  });

  it('saves the nickname from the sticky save bar', async () => {
    const updated = { ...profile, nickname: 'Taras' };
    const updateProfile = vi.spyOn(monopolyBankApi, 'updateProfile').mockResolvedValue(updated);
    const { user, onUpdated } = setup();
    const nickname = screen.getByLabelText('Nickname');
    await user.clear(nickname);
    await user.type(nickname, 'Taras');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(updateProfile).toHaveBeenCalledWith({ nickname: 'Taras', avatar: 'fox' });
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });
});
