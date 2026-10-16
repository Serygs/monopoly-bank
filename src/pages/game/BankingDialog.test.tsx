import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { defaultGameRules } from '../../../shared/types/monopoly';
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
          within(keypad).getByRole('button', { name: key === ',' ? 'Decimal separator' : key }),
        ),
      ),
    Promise.resolve(),
  );
}

describe('BankingDialog amount entry', () => {
  it('keeps the typed digits when the unit changes and only changes the multiplier', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Millions' }));
    await press(user, '3');
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(amount).toHaveValue('3');
    expect(screen.getByText('= $3 000 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thousands' }));
    expect(amount).toHaveValue('3');
    expect(screen.getByText('= $3 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Millions' }));
    expect(amount).toHaveValue('3');
    expect(screen.getByText('= $3 000 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(amount).toHaveValue('3');
    expect(screen.getByText('= $3')).toBeInTheDocument();
  });

  it('flags a decimal that is not a whole amount in whole units and restores it in millions', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Millions' }));
    await press(user, '1', ',', '5');
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(screen.getByText('= $1 500 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(amount).toHaveValue('1.5');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Millions' }));
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('= $1 500 000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
  });

  it('shows the shortfall and offers bankruptcy when the payer cannot afford the amount', async () => {
    const { user, props } = renderDialog([olena, taras], { player: taras });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '1500000');
    expect(screen.getByText('Short by $500 000.')).toBeInTheDocument();
    const shortfall = screen.getByText('Short by $500 000.').parentElement as HTMLElement;
    await user.click(within(shortfall).getByRole('button', { name: 'Declare bankrupt' }));
    expect(props.onBankrupt).toHaveBeenCalledOnce();
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

describe('BankingDialog house rules', () => {
  const settings = buildGameSettings(15_000_000);

  it('offers the exact-landing action only when the game enables the rule', async () => {
    const off = renderDialog([olena, taras]);
    expect(screen.queryByRole('button', { name: /Landed exactly on GO/ })).toBeNull();
    off.props.onClose();
  });

  it('pays double from the exact-landing action and sends the flag', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 400_000 },
      players: [],
    } as never);
    const { user, props } = renderDialog([olena, taras], {
      rules: { ...defaultGameRules, doubleRewardOnExactGo: true },
      passGoReward: 200_000,
    });
    await user.click(screen.getByRole('button', { name: 'Landed exactly on GO (double)' }));
    expect(screen.getAllByText('$400 000').length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(
      'Landed exactly on GO: double reward',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ type: 'PASS_GO', playerId: 'p1', exactLanding: true }),
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalled();
    createTransaction.mockRestore();
  });

  it('keeps the plain Pass GO at the normal reward without the flag', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 200_000 },
      players: [],
    } as never);
    const { user } = renderDialog([olena, taras], {
      rules: { ...defaultGameRules, doubleRewardOnExactGo: true },
      passGoReward: 200_000,
    });
    await user.click(screen.getByRole('button', { name: 'Pass GO' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    const request = createTransaction.mock.calls[0]?.[1];
    expect(request).toEqual({ type: 'PASS_GO', playerId: 'p1' });
    createTransaction.mockRestore();
  });

  it('shows the taxes and jail fine from the game settings and reviews the chosen one', async () => {
    const { user } = renderDialog([olena, taras], { settings });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    const group = screen.getByRole('group', { name: 'Taxes and fines' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Income tax · $2 000 000', 'Luxury tax · $1 000 000', 'Jail fine · $500 000']);
    await user.click(within(group).getByRole('button', { name: /Luxury tax/ }));
    expect(screen.getByRole('button', { name: 'Confirm transaction' })).toBeEnabled();
    expect(screen.getByText('Luxury tax')).toBeInTheDocument();
  });

  it('fills the amount but stays on the form when the payer cannot afford the fixed payment', async () => {
    const { user } = renderDialog([olena, taras], { player: taras, settings });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: /Income tax/ }));
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
    expect(screen.getByText('Short by $1 000 000.')).toBeInTheDocument();
  });

  it('hides the fixed payments for games created before the settings snapshot', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    expect(screen.queryByRole('group', { name: 'Taxes and fines' })).toBeNull();
  });
});

describe('BankingDialog mortgages', () => {
  const boardwalk = {
    id: 'm1',
    gameId: 'g1',
    playerId: 'p1',
    propertyName: 'Boardwalk',
    mortgageValue: 400_000,
    createdAt: '',
  };

  it('offers to mortgage always, but to redeem only when the player has a mortgage', () => {
    const without = renderDialog([olena, taras]);
    expect(screen.getByRole('button', { name: 'Mortgage property' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redeem mortgage' })).toBeNull();
    without.props.onClose();
  });

  it('shows the redeem action for the owner of a mortgage but not for another player', () => {
    renderDialog([olena, taras], { mortgages: [{ ...boardwalk, playerId: 'p2' }] });
    expect(screen.queryByRole('button', { name: 'Redeem mortgage' })).toBeNull();
  });

  it('needs a name, a value and the no-buildings confirmation before it can be reviewed', async () => {
    const { user } = renderDialog([olena, taras]);
    await user.click(screen.getByRole('button', { name: 'Mortgage property' }));
    const review = screen.getByRole('button', { name: 'Review transaction' });
    expect(review).toBeDisabled();

    await user.click(screen.getByRole('textbox', { name: 'Property name' }));
    await user.paste('Boardwalk');
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await press(user, '4', '0', '0');
    expect(review).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /no houses or hotels/i }));
    expect(review).toBeEnabled();
  });

  it('sends the tidied name and value, then reports the new mortgage list', async () => {
    const created = { ...boardwalk, propertyName: 'Park Place' };
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 400 },
      players: [],
      mortgages: [created],
    } as never);
    const { user, props } = renderDialog([olena, taras]);

    await user.click(screen.getByRole('button', { name: 'Mortgage property' }));
    await user.click(screen.getByRole('textbox', { name: 'Property name' }));
    await user.paste('  Park   Place ');
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await press(user, '4', '0', '0');
    await user.click(screen.getByRole('checkbox', { name: /no houses or hotels/i }));
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    expect(screen.getByText('Park Place')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'MORTGAGE', playerId: 'p1', propertyName: 'Park Place', amount: 400 },
      expect.any(String),
    );
    // A mortgage is not an amount the table reuses, so no recent amount is reported.
    expect(props.onCompleted).toHaveBeenCalledWith([], 'MORTGAGE', null, [created]);
    createTransaction.mockRestore();
  });

  it('lists the mortgages with their redemption cost and reviews the chosen one', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 440_000 },
      players: [],
      mortgages: [],
    } as never);
    const { user, props } = renderDialog([olena, taras], { mortgages: [boardwalk] });

    await user.click(screen.getByRole('button', { name: 'Redeem mortgage' }));
    const choice = screen.getByRole('button', { name: /Boardwalk/ });
    expect(choice).toHaveTextContent('Redeem for $440 000 (value $400 000 + 10%)');
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();

    await user.click(choice);
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    expect(screen.getByText('Boardwalk')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'MORTGAGE_REDEMPTION', playerId: 'p1', mortgageId: 'm1' },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith([], 'MORTGAGE_REDEMPTION', null, []);
    createTransaction.mockRestore();
  });

  it('blocks a redemption the player cannot afford and says how much is missing', async () => {
    const { user } = renderDialog([olena, taras], {
      player: taras,
      mortgages: [{ ...boardwalk, playerId: 'p2', mortgageValue: 2_000_000 }],
    });
    await user.click(screen.getByRole('button', { name: 'Redeem mortgage' }));
    await user.click(screen.getByRole('button', { name: /Boardwalk/ }));

    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
    expect(screen.getByText('Short by $1 200 000.')).toBeInTheDocument();
  });

  it("tells a payer which of the recipient's properties are mortgaged", async () => {
    renderDialog([olena, taras], { mortgages: [{ ...boardwalk, playerId: 'p2' }] });
    const { user } = { user: userEvent.setup() };
    await user.click(screen.getByRole('button', { name: 'Pay Player' }));
    expect(
      screen.getByText('Taras has mortgaged: Boardwalk. No rent is due on those.'),
    ).toBeInTheDocument();
  });
});
