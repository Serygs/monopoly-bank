import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { BankingDialog, type BankingDialogProps } from './BankingDialog';

function player(id: string, name: string, balance: number): Player {
  return { id, gameId: 'g1', name, color: '#2563eb', balance, createdAt: '' };
}

const olena = player('p1', 'Olena', 5_000_000);
const taras = player('p2', 'Taras', 1_000_000);
const iryna = player('p3', 'Iryna', 2_000_000);

function renderDialog(players: Player[], overrides: Partial<BankingDialogProps> = {}) {
  const props: BankingDialogProps = {
    gameId: 'g1',
    player: olena,
    players,
    passGoReward: 200_000,
    currency: 'USD',
    favoriteAmounts: [],
    recentAmounts: [],
    onToggleFavorite: vi.fn(),
    onClose: vi.fn(),
    onBankrupt: vi.fn(),
    onViewHistory: vi.fn(),
    onCompleted: vi.fn(),
    onPaymentRequested: vi.fn(),
    ...overrides,
  };
  render(
    <LanguageProvider>
      <BankingDialog {...props} />
    </LanguageProvider>,
  );
  return { props, user: userEvent.setup() };
}

function press(user: ReturnType<typeof userEvent.setup>, ...keys: string[]) {
  const keypad = screen.getByRole('group', { name: 'Numeric keypad' });
  return keys.reduce(
    (chain, key) =>
      chain.then(() =>
        user.click(
          within(keypad).getByRole('button', {
            name: key === ',' ? 'Decimal separator' : key,
            exact: true,
          }),
        ),
      ),
    Promise.resolve(),
  );
}

describe('BankingDialog amount entry', () => {
  it('keeps the typed amount when the unit changes and recalculates it', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await press(user, '8', '5', '0', '0', '0');
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(amount).toHaveValue('85 000');
    expect(screen.getByText('= $85 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thousands' }));
    expect(amount).toHaveValue('85');
    expect(screen.getByText('= $85 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Millions' }));
    expect(amount).toHaveValue('0.085');
    expect(screen.getByText('= $85 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(amount).toHaveValue('85 000');
  });

  it('takes a decimal in millions and shows the whole total in front', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    expect(screen.getByRole('button', { name: 'Decimal separator' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Millions' }));
    await press(user, '3', ',', '2');
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('3.2');
    expect(screen.getByText('= $3 200 000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decimal separator' })).toBeDisabled();
  });

  it('accepts a comma typed into the field', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Millions' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '2,5');
    expect(screen.getByText('= $2 500 000')).toBeInTheDocument();
  });

  it('clears the amount with the clear button', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    await press(user, '7');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
  });

  it('offers quick amounts scaled to the starting balance', async () => {
    const { user } = renderDialog([olena, taras], { startingBalance: 15_000_000 });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    const quick = screen.getByRole('group', { name: 'Quick' });
    const labels = within(quick)
      .getAllByRole('button')
      .map((chip) => chip.textContent);
    expect(labels).toEqual([
      '$1 000 000',
      '$1 500 000',
      '$2 000 000',
      '$3 000 000',
      '$5 000 000',
      '$10 000 000',
    ]);
  });
});

describe('BankingDialog compact flow', () => {
  it('preselects the only recipient and skips the choice', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Player' }));
    expect(screen.getByRole('group', { name: 'Choose recipient' })).toHaveTextContent('Taras');
    // A quick amount needs no recipient tap: it goes straight to the confirmation.
    await user.click(screen.getByRole('button', { name: /100 000/ }));
    expect(screen.getByRole('button', { name: 'Confirm transaction' })).toBeEnabled();
  });

  it('keeps the recipient choice when several players can be paid', async () => {
    const { user } = renderDialog([olena, taras, iryna]);
    await user.click(screen.getByRole('button', { name: 'Pay Player' }));
    expect(screen.getByRole('button', { name: /Taras/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Iryna/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
  });

  it('collapses the comment until it is asked for', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add a comment/ }));
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
  });

  it('opens Pass GO on its confirmation and returns to the actions with Back', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pass GO' }));
    expect(screen.getByRole('button', { name: 'Confirm transaction' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Pay Player' })).toBeInTheDocument();
  });

  it('returns from the form to the action list with Back', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Pay Bank' })).toBeInTheDocument();
  });

  it('keeps the system keyboard closed on the amount field', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('inputmode', 'none');
  });
});
