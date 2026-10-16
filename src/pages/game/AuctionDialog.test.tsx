import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auction, Player } from '../../../shared/types/monopoly';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { AuctionDialog, type AuctionDialogProps } from './AuctionDialog';

function player(id: string, name: string, balance: number): Player {
  return { id, gameId: 'g1', name, color: '#2563eb', balance, createdAt: '' };
}

const olena = player('p1', 'Olena', 1_000);
const taras = player('p2', 'Taras', 5_000);
const settings = buildGameSettings(1_500);
const steps = settings.auctionBidSteps;

const base: Auction = {
  id: 'a1',
  gameId: 'g1',
  lotName: 'Park Place',
  initiatorPlayerId: 'p2',
  state: 'ACTIVE',
  currentBid: 0,
  currentBidderId: null,
  version: 1,
  startedAt: '2026-10-16T12:00:00.000Z',
  endsAt: '2026-10-16T12:00:30.000Z',
  serverTime: '2026-10-16T12:00:05.000Z',
  settledTransactionId: null,
};

function renderDialog(overrides: Partial<AuctionDialogProps> = {}) {
  const props: AuctionDialogProps = {
    gameId: 'g1',
    auction: base,
    players: [olena, taras],
    controlledPlayerIds: ['p1'],
    currency: 'USD',
    settings,
    canMutate: true,
    onClose: vi.fn(),
    onUpdated: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  const view = render(
    <LanguageProvider>
      <AuctionDialog {...props} />
    </LanguageProvider>,
  );
  return { props, view };
}

const bidButtons = () => screen.getAllByRole('button', { name: /Raise the bid by/ });

describe('AuctionDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The device clock runs 10 minutes ahead of the server clock.
    vi.setSystemTime(new Date('2026-10-16T12:10:05.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('shows the lot, no bids yet and a countdown from the server clock', () => {
    renderDialog();
    expect(screen.getByText('Park Place')).toBeInTheDocument();
    expect(screen.getByText('No bids yet')).toBeInTheDocument();
    expect(screen.getByText('25 s')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText('15 s')).toBeInTheDocument();
  });

  it('sends a bid for the chosen step with the version it saw', async () => {
    const placeBid = vi.spyOn(monopolyBankApi, 'placeBid').mockResolvedValue({
      auction: { ...base, version: 2, currentBid: 10, currentBidderId: 'p1' },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { props } = renderDialog();
    expect(bidButtons()).toHaveLength(steps.length);
    await user.click(bidButtons()[3] as HTMLElement);
    expect(placeBid).toHaveBeenCalledWith(
      'g1',
      { bidderPlayerId: 'p1', auctionId: 'a1', expectedVersion: 1, step: steps[3] },
      expect.any(String),
    );
    await waitFor(() => expect(props.onUpdated).toHaveBeenCalled());
    placeBid.mockRestore();
  });

  it('disables bids for the leader and when the cash does not cover the next bid', () => {
    const { view } = renderDialog({
      auction: { ...base, currentBid: 10, currentBidderId: 'p1', version: 2 },
    });
    for (const button of bidButtons()) expect(button).toBeDisabled();
    expect(screen.getByText('This wallet already leads the auction.')).toBeInTheDocument();
    view.unmount();

    renderDialog({ auction: { ...base, currentBid: 995, currentBidderId: 'p2', version: 2 } });
    for (const button of bidButtons()) expect(button).toBeDisabled();
    expect(screen.getByText('Not enough available cash for the next bid.')).toBeInTheDocument();
  });

  it('lets a viewer with two wallets choose which one bids', async () => {
    const placeBid = vi.spyOn(monopolyBankApi, 'placeBid').mockResolvedValue({ auction: base });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDialog({ controlledPlayerIds: ['p1', 'p2'] });
    await user.click(screen.getByRole('button', { name: 'Taras' }));
    await user.click(bidButtons()[0] as HTMLElement);
    expect(placeBid).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ bidderPlayerId: 'p2' }),
      expect.any(String),
    );
    placeBid.mockRestore();
  });

  it('keeps the dialog open on a stale bid and hands over the newer auction', async () => {
    const newer = { ...base, version: 3, currentBid: 20, currentBidderId: 'p2' };
    const placeBid = vi.spyOn(monopolyBankApi, 'placeBid').mockRejectedValue(
      new MonopolyBankApiError({
        code: 'AUCTION_BID_STALE',
        message: 'stale',
        details: { auction: newer },
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { props } = renderDialog();
    await user.click(bidButtons()[0] as HTMLElement);
    expect(
      await screen.findByText('Someone bid first. The auction was refreshed; try again.'),
    ).toBeInTheDocument();
    expect(props.onUpdated).toHaveBeenCalledWith({ auction: newer });
    expect(props.onClose).not.toHaveBeenCalled();
    placeBid.mockRestore();
  });

  it('asks for the result once the time is up and shows Closing', () => {
    const { props } = renderDialog({
      auction: { ...base, serverTime: '2026-10-16T12:00:31.000Z' },
    });
    expect(screen.getByText('Closing…')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(600));
    expect(props.onRefresh).toHaveBeenCalled();
    for (const button of bidButtons()) expect(button).toBeDisabled();
  });

  it('shows the result of a sold and an unsold auction', () => {
    const { view } = renderDialog({
      auction: {
        ...base,
        state: 'SOLD',
        currentBid: 120,
        currentBidderId: 'p2',
        version: 5,
        settledTransactionId: 't1',
      },
    });
    expect(screen.getByText('Sold to Taras for $120')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise the bid by/ })).not.toBeInTheDocument();
    view.unmount();
    renderDialog({ auction: { ...base, state: 'NO_SALE', version: 2 } });
    expect(screen.getByText('No sale')).toBeInTheDocument();
  });
});
