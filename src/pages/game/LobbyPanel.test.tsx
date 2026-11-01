import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import { defaultGameRules, type Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { LobbyPanel } from './LobbyPanel';

const player = (id: string): Player => ({
  id,
  gameId: 'g',
  name: `Player ${id}`,
  color: '#126247',
  balance: 100,
  createdAt: '',
});
const details = (status: GameDetails['game']['status'], count = 3): GameDetails => ({
  game: {
    id: 'g',
    name: 'Game',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status,
    createdAt: '',
    updatedAt: '',
  },
  players: ['a', 'b', 'c'].slice(0, count).map(player),
  controlledPlayerIds: ['a'],
  canManage: true,
});

function show(value: GameDetails, offline = false) {
  const setDetails = vi.fn();
  render(
    <LanguageProvider>
      <LobbyPanel gameId="g" details={value} setDetails={setDetails} offline={offline} />
    </LanguageProvider>,
  );
  return setDetails;
}

describe('LobbyPanel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders nothing once the game has started', () => {
    show(details('ACTIVE'));
    expect(screen.queryByText('Waiting for players')).not.toBeInTheDocument();
  });

  it('lists the players the viewer does not control and removes one', async () => {
    const after = details('LOBBY', 2);
    vi.spyOn(monopolyBankApi, 'removeLobbyPlayer').mockResolvedValue(after);
    const setDetails = show(details('LOBBY'));
    expect(screen.queryByRole('button', { name: 'Remove Player a' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Player b' }));
    await waitFor(() => expect(setDetails).toHaveBeenCalled());
    expect(monopolyBankApi.removeLobbyPlayer).toHaveBeenCalledWith('g', 'b');
  });

  it('shows why a removal failed', async () => {
    vi.spyOn(monopolyBankApi, 'removeLobbyPlayer').mockRejectedValue(
      new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'x' }),
    );
    show(details('LOBBY'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Player b' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('starts the game only with enough players and online', async () => {
    vi.spyOn(monopolyBankApi, 'startGame').mockResolvedValue(details('ACTIVE'));
    const setDetails = show(details('LOBBY'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(setDetails).toHaveBeenCalled());
    const lobby: GameDetails = {
      ...details('LOBBY'),
      controlledWallets: [{ playerId: 'a', kind: 'PRIMARY' }],
      joinCode: 'JOIN',
    };
    const apply = setDetails.mock.calls[0]?.[0] as (current: GameDetails | null) => GameDetails;
    const next = apply(lobby);
    expect(next.game.status).toBe('ACTIVE');
    expect(next.controlledWallets).toEqual([{ playerId: 'a', kind: 'PRIMARY' }]);
    expect(next.controlledPlayerIds).toEqual(['a']);
    expect(next.canManage).toBe(true);
    expect(next.joinCode).toBe('JOIN');
  });

  it('disables starting while offline', () => {
    show(details('LOBBY'), true);
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
  });
});
