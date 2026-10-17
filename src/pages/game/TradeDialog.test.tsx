import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TradeRequest } from '../../../shared/contracts/api';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { GameProperty, Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { TradeDialog } from './TradeDialog';
import { TradeInbox } from './TradeInbox';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const player = (id: string, name: string, balance = 100_000): Player => ({
  id,
  gameId: 'g',
  name,
  color: '#123456',
  balance,
  status: 'ACTIVE',
  createdAt: '',
});
const ada = player('a', 'Ada');
const bo = player('b', 'Bo');
const row = (tileId: string, ownerPlayerId: string, mortgaged = false): GameProperty => ({
  gameId: 'g',
  tileId,
  ownerPlayerId,
  mortgaged,
  houses: 0,
});
const request: TradeRequest = {
  id: 'tr1',
  gameId: 'g',
  proposerPlayerId: 'a',
  counterpartyPlayerId: 'b',
  giveTileIds: ['zhitna'],
  takeTileIds: [],
  cashGive: 0,
  cashTake: 0,
  state: 'PENDING',
  expiresAt: '',
  createdAt: '',
  resolvedAt: null,
  transactionId: null,
};

describe('TradeDialog', () => {
  it('sends a request, reviews both sides with the gift notice and then waits with Cancel', async () => {
    const create = vi
      .spyOn(monopolyBankApi, 'createTradeRequest')
      .mockResolvedValue({ tradeRequest: request });
    const cancel = vi.spyOn(monopolyBankApi, 'cancelTradeRequest').mockResolvedValue({
      tradeRequest: { ...request, state: 'CANCELLED' as never },
      players: [],
    });
    const onRequested = vi.fn();
    const onCancelled = vi.fn();
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <TradeDialog
          gameId="g"
          player={ada}
          players={[ada, bo]}
          currency="USD"
          board={board}
          properties={[row('zhitna', 'a'), row('nagatinska', 'b', true)]}
          onClose={vi.fn()}
          onRequested={onRequested}
          onCancelled={onCancelled}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText(/The other player must accept/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Zhitna|Житна/i }));
    // The mortgage rule has its own info block because a mortgaged tile is on offer.
    expect(screen.getByRole('status')).toHaveTextContent(/10%/);
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    expect(
      screen.getByText(/Bo gets nothing back|Bo receives|receives this as a gift/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send trade request' }));
    expect(create).toHaveBeenCalledWith(
      'g',
      expect.objectContaining({
        playerId: 'a',
        counterpartyPlayerId: 'b',
        giveTileIds: ['zhitna'],
      }),
      expect.any(String),
    );
    expect(onRequested).toHaveBeenCalledWith(request);
    expect(screen.getByText('Waiting for Bo to answer the trade.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(cancel).toHaveBeenCalledWith('g', 'tr1', expect.any(String));
    expect(onCancelled).toHaveBeenCalled();
    create.mockRestore();
    cancel.mockRestore();
  });

  it('uses switches for the cash options', () => {
    render(
      <LanguageProvider>
        <TradeDialog
          gameId="g"
          player={ada}
          players={[ada, bo]}
          currency="USD"
          board={board}
          properties={[row('zhitna', 'a')]}
          onClose={vi.fn()}
          onRequested={vi.fn()}
        />
      </LanguageProvider>,
    );
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('TradeInbox', () => {
  const properties = [row('zhitna', 'a')];
  it('lets the counterparty review the trade and accept or decline it', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <TradeInbox
          incoming={[request]}
          outgoing={[]}
          players={[ada, bo]}
          currency="USD"
          board={board}
          properties={properties}
          onAction={onAction}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('Ada proposes a trade')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/Zhitna|Житна/i)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Accept trade' }));
    expect(onAction).toHaveBeenCalledWith(request, 'accept');
  });

  it('shows the proposer a waiting row with Cancel', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <TradeInbox
          incoming={[]}
          outgoing={[request]}
          players={[ada, bo]}
          currency="USD"
          board={board}
          properties={properties}
          onAction={onAction}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('Waiting for Bo to answer the trade.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(onAction).toHaveBeenCalledWith(request, 'cancel');
  });
});
