import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import { defaultGameRules, type GameProperty, type Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { FeedbackProvider } from '../../components/ui';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { GameContext } from './game-context';
import { ManagementDialogs } from './ManagementDialogs';

const player = (id: string, balance: number): Player => ({
  id,
  gameId: 'g',
  name: `Player ${id}`,
  color: '#126247',
  balance,
  createdAt: '',
});
const property = (tileId: string, ownerPlayerId: string | null): GameProperty =>
  ({ gameId: 'g', tileId, ownerPlayerId }) as unknown as GameProperty;
const base: GameDetails = {
  game: {
    id: 'g',
    name: 'Game',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
  },
  players: [player('a', 100), player('b', 100)],
  properties: [property('t1', 'a')],
};
const reversing = {
  id: 'x1',
  gameId: 'g',
  type: 'PLAYER_TO_PLAYER' as const,
  amount: 10,
  totalAmount: 10,
  comment: null,
  createdAt: '',
  participants: [
    { playerId: 'a', balanceDelta: -10 },
    { playerId: 'b', balanceDelta: 10 },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('ManagementDialogs reversal', () => {
  it('applies the reversal on top of the newest state, not the state it was opened with', async () => {
    vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { ...reversing, id: 'r1' },
      players: [player('a', 110), player('b', 90)],
      properties: [property('t2', null)],
    } as never);
    const setDetails = vi.fn();
    const ctx = {
      gameId: 'g',
      details: base,
      setDetails,
      dialogs: {
        sheets: { inviteOpen: false, finishing: false },
        activity: { reversing, setReversing: vi.fn(), setVersion: vi.fn() },
      },
    } as unknown as GameContext;
    render(
      <LanguageProvider>
        <FeedbackProvider>
          <ManagementDialogs ctx={ctx} />
        </FeedbackProvider>
      </LanguageProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm reversal' }));
    await waitFor(() => expect(setDetails).toHaveBeenCalled());
    const apply = setDetails.mock.calls[0]?.[0] as (current: GameDetails) => GameDetails;
    // A purchase of t3 landed over the live socket while the reversal was in flight.
    const newer: GameDetails = { ...base, properties: [property('t1', 'a'), property('t3', 'b')] };
    const next = apply(newer);
    expect(next.players.map((p) => p.balance)).toEqual([110, 90]);
    expect(next.properties?.map((p) => p.tileId).sort()).toEqual(['t1', 't2', 't3']);
  });
});
