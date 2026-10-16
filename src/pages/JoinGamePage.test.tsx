import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails, UserProfile } from '../../shared/contracts/api';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { JoinEntryPage } from './JoinEntryPage';
import { JoinGamePage } from './JoinGamePage';

const details = { game: { id: 'game-1' }, players: [] } as unknown as GameDetails;
const guestProfile = { id: 'guest-1', nickname: 'Visitor' } as UserProfile;

function renderJoin(props: Partial<React.ComponentProps<typeof JoinGamePage>> = {}) {
  const handlers = { onJoined: vi.fn(), onBack: vi.fn(), onGuestJoined: undefined };
  render(
    <LanguageProvider>
      <JoinGamePage initialJoinCode="" invitationToken="" {...handlers} {...props} />
    </LanguageProvider>,
  );
  return { ...handlers, ...props };
}

afterEach(() => vi.restoreAllMocks());

describe('JoinGamePage', () => {
  it('joins a signed-in visitor straight away from a link, without showing a form', async () => {
    const join = vi.spyOn(monopolyBankApi, 'joinGame').mockResolvedValue(details);
    const onJoined = vi.fn();
    renderJoin({ initialJoinCode: 'k7p2', autoJoin: true, onJoined });
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('game-1'));
    expect(join).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith({ joinCode: 'K7P2' });
  });

  it('joins a signed-in visitor straight away from a secure invitation token', async () => {
    const join = vi.spyOn(monopolyBankApi, 'joinGame').mockResolvedValue(details);
    const onJoined = vi.fn();
    renderJoin({ invitationToken: 'T'.repeat(43), autoJoin: true, onJoined });
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('game-1'));
    expect(join).toHaveBeenCalledWith({ invitationToken: 'T'.repeat(43) });
  });

  it('asks for the table password only after the code alone was refused', async () => {
    const join = vi
      .spyOn(monopolyBankApi, 'joinGame')
      .mockRejectedValueOnce(
        new MonopolyBankApiError({ code: 'INVALID_JOIN_CODE', message: 'Game not found.' }),
      )
      .mockResolvedValueOnce(details);
    const onJoined = vi.fn();
    renderJoin({ initialJoinCode: 'K7P2', autoJoin: true, onJoined });
    const password = await screen.findByLabelText(/password/i);
    expect(screen.queryByLabelText(/game code/i)).toBeNull();
    await userEvent.type(password, 'secret1');
    await userEvent.click(screen.getByRole('button', { name: /join game/i }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('game-1'));
    expect(join).toHaveBeenLastCalledWith({ joinCode: 'K7P2', gameAccessPassword: 'secret1' });
  });

  it('shows the form with a full-lobby error and does not retry', async () => {
    const join = vi
      .spyOn(monopolyBankApi, 'joinGame')
      .mockRejectedValue(new MonopolyBankApiError({ code: 'LOBBY_FULL', message: 'full' }));
    renderJoin({ initialJoinCode: 'K7P2', autoJoin: true });
    expect(await screen.findByText(/full/i)).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(join).toHaveBeenCalledTimes(1);
  });

  it('rejects a manual code through the API error and normalizes it first', async () => {
    const join = vi
      .spyOn(monopolyBankApi, 'joinGame')
      .mockRejectedValue(new MonopolyBankApiError({ code: 'INVALID_JOIN_CODE', message: 'x' }));
    renderJoin();
    await userEvent.type(screen.getByLabelText(/game code/i), ' ab12 ');
    await userEvent.click(screen.getByRole('button', { name: /join game/i }));
    expect(await screen.findByText(/incorrect, expired, or revoked/i)).toBeTruthy();
    expect(join).toHaveBeenCalledWith({ joinCode: 'AB12' });
  });

  it('lets a guest join with only a name', async () => {
    const guest = vi
      .spyOn(monopolyBankApi, 'joinGameAsGuest')
      .mockResolvedValue({ profile: guestProfile, game: details });
    const onGuestJoined = vi.fn();
    renderJoin({ initialJoinCode: 'K7P2', onGuestJoined });
    expect(screen.queryByLabelText(/game code/i)).toBeNull();
    expect(screen.queryByText(/avatar/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/nickname/i), 'Visitor');
    await userEvent.click(screen.getByRole('button', { name: /join as guest/i }));
    await waitFor(() => expect(onGuestJoined).toHaveBeenCalledWith(guestProfile, 'game-1'));
    expect(guest).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: 'Visitor', joinCode: 'K7P2' }),
    );
  });
});

describe('JoinEntryPage', () => {
  it('offers sign in, register and a separate guest option', async () => {
    const handlers = { onSignIn: vi.fn(), onRegister: vi.fn(), onGuest: vi.fn() };
    render(
      <LanguageProvider>
        <JoinEntryPage {...handlers} />
      </LanguageProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await userEvent.click(screen.getByRole('button', { name: /create your account/i }));
    await userEvent.click(screen.getByRole('button', { name: /play as guest/i }));
    expect(handlers.onSignIn).toHaveBeenCalledOnce();
    expect(handlers.onRegister).toHaveBeenCalledOnce();
    expect(handlers.onGuest).toHaveBeenCalledOnce();
  });
});
