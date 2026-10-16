import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player, Transaction } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ReverseTransactionDialog } from './ReverseTransactionDialog';

const player = (id: string, name: string, balance: number): Player => ({
  id,
  gameId: 'g1',
  name,
  color: '#2563eb',
  balance,
  createdAt: '',
});
const ada = player('p1', 'Ada', 1_400);
const bo = player('p2', 'Bo', 1_600);

const payment: Transaction = {
  id: 't1',
  gameId: 'g1',
  type: 'PLAYER_TO_PLAYER',
  amount: 100,
  totalAmount: 100,
  comment: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  participants: [
    { playerId: 'p1', balanceDelta: -100 },
    { playerId: 'p2', balanceDelta: 100 },
  ],
};

afterEach(() => vi.restoreAllMocks());

function renderDialog() {
  const onClose = vi.fn();
  const onReversed = vi.fn();
  render(
    <LanguageProvider>
      <ReverseTransactionDialog
        gameId="g1"
        transaction={payment}
        players={[ada, bo]}
        currency="USD"
        language="en"
        onClose={onClose}
        onReversed={onReversed}
      />
    </LanguageProvider>,
  );
  return { onClose, onReversed, user: userEvent.setup() };
}

describe('ReverseTransactionDialog', () => {
  it('shows how each balance changes before anything is recorded', () => {
    renderDialog();
    expect(screen.getByText('Ada → Bo')).toBeInTheDocument();
    const effects = screen.getByRole('list', { name: 'How each balance changes' });
    expect(effects).toHaveTextContent('Ada');
    expect(effects).toHaveTextContent('+$100');
    expect(effects).toHaveTextContent('Bo');
    expect(effects).toHaveTextContent('-$100');
  });

  it('records a reversal of that transaction with the note and reports the new balances', async () => {
    const reversed = [player('p1', 'Ada', 1_500), player('p2', 'Bo', 1_500)];
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ transaction: { id: 'r1' }, players: reversed } as never);
    const { user, onReversed } = renderDialog();

    await user.type(screen.getByRole('textbox', { name: 'Comment' }), ' Wrong player ');
    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'REVERSAL', transactionId: 't1', comment: 'Wrong player' },
      expect.any(String),
    );
    expect(onReversed).toHaveBeenCalledWith(reversed);
  });

  it('retries with the same command ID so a dropped response cannot reverse twice', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockRejectedValueOnce(
        new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'offline', requestId: 'r1' }),
      )
      .mockResolvedValue({ transaction: { id: 'r1' }, players: [] } as never);
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm reversal' }));

    const ids = createTransaction.mock.calls.map((call) => call[2]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it.each([
    ['TRANSACTION_ALREADY_REVERSED', 'This transaction has already been reversed.'],
    ['REVERSAL_WINDOW_EXPIRED', 'Only the game owner can reverse this transaction now.'],
    ['TRANSACTION_NOT_REVERSIBLE', 'This kind of transaction cannot be reversed.'],
  ])('explains %s and stays open', async (code, message) => {
    vi.spyOn(monopolyBankApi, 'createTransaction').mockRejectedValue(
      new MonopolyBankApiError({ code, message: 'server text', requestId: 'r1' }),
    );
    const { user, onReversed } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onReversed).not.toHaveBeenCalled();
  });

  it('names the player who no longer holds the money', async () => {
    vi.spyOn(monopolyBankApi, 'createTransaction').mockRejectedValue(
      new MonopolyBankApiError({
        code: 'INSUFFICIENT_FUNDS',
        message: 'no',
        requestId: 'r1',
        details: { playerId: 'p2', currentBalance: 40, requiredAmount: 100 },
      }),
    );
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Confirm reversal' }));

    expect(await screen.findByText(/Bo has insufficient funds/)).toBeInTheDocument();
  });

  it('closes without recording anything', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction');
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(createTransaction).not.toHaveBeenCalled();
  });
});
