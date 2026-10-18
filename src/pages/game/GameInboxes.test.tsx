import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails, PaymentRequest } from '../../../shared/contracts/api';
import { defaultGameRules, type Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { FeedbackProvider } from '../../components/ui';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { GameContext } from './game-context';
import { GameInboxes } from './GameInboxes';

const players: Player[] = ['a', 'b'].map((id) => ({
  id,
  gameId: 'g',
  name: `Player ${id}`,
  color: '#126247',
  balance: 100,
  createdAt: '',
}));
const pending: PaymentRequest = {
  id: 'r1',
  kind: 'PAYMENT',
  gameId: 'g',
  payerPlayerId: 'b',
  recipientPlayerId: 'a',
  creatorPlayerId: 'a',
  approverPlayerId: 'b',
  amount: 30,
  comment: null,
  state: 'PENDING',
  expiresAt: '2026-01-01T00:00:00.000Z',
  createdAt: '',
  resolvedAt: null,
  transactionId: null,
};
const details: GameDetails = {
  game: {
    id: 'g',
    name: 'Game',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'CONFIRMATION',
    rules: defaultGameRules,
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
  },
  players,
};

function context(canMutate: boolean) {
  const setDetails = vi.fn();
  const setPaymentRequests = vi.fn();
  const ctx = {
    gameId: 'g',
    details,
    setDetails,
    setPaymentRequests,
    preferences: { sound: false, vibration: false },
    putTradeRequest: vi.fn(),
    view: {
      canMutate,
      confirmationMode: true,
      inboxRequests: [pending],
      outgoingLoanRequests: [],
      incomingTrades: [],
      outgoingTrades: [],
      board: null,
      properties: [],
    },
  } as unknown as GameContext;
  render(
    <LanguageProvider>
      <FeedbackProvider>
        <GameInboxes ctx={ctx} />
      </FeedbackProvider>
    </LanguageProvider>,
  );
  return { setDetails, setPaymentRequests };
}

describe('GameInboxes', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows nothing while changes are not allowed', () => {
    context(false);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('accepts a request, drops it from the list and applies the new balances', async () => {
    const accept = vi.spyOn(monopolyBankApi, 'acceptPaymentRequest').mockResolvedValue({
      paymentRequest: { ...pending, state: 'ACCEPTED' },
      players: players.map((p) => ({ ...p, balance: 70 })),
      transaction: {
        id: 't1',
        gameId: 'g',
        type: 'PLAYER_TO_PLAYER',
        amount: 30,
        totalAmount: 30,
        comment: null,
        createdAt: '',
        participants: [],
      },
    });
    const { setDetails, setPaymentRequests } = context(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(setDetails).toHaveBeenCalled());
    expect(accept).toHaveBeenCalledWith('g', 'r1', expect.any(String));
    expect(setPaymentRequests).toHaveBeenCalled();
    const apply = setDetails.mock.calls[0]?.[0] as (current: GameDetails) => GameDetails;
    expect(apply(details).players[0]?.balance).toBe(70);
  });

  it('declines a request without touching the balances', async () => {
    vi.spyOn(monopolyBankApi, 'declinePaymentRequest').mockResolvedValue({
      paymentRequest: { ...pending, state: 'DECLINED' },
      players,
    });
    const { setDetails, setPaymentRequests } = context(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(setPaymentRequests).toHaveBeenCalled());
    expect(setDetails).not.toHaveBeenCalled();
  });
});
