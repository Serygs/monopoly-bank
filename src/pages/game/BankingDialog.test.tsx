import { render, screen } from '@testing-library/react';
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
