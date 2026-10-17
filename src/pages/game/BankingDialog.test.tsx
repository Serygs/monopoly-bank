import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { Auction, GameProperty, Loan, Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
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
    expect(screen.queryByRole('switch', { name: /Landed exactly on GO/ })).toBeNull();
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
    await user.click(screen.getByRole('switch', { name: 'Landed exactly on GO (double)' }));
    await user.click(screen.getByRole('button', { name: 'Pass GO' }));
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
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'MORTGAGE',
      null,
      [created],
      undefined,
      undefined,
      undefined,
      undefined,
    );
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
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'MORTGAGE_REDEMPTION',
      null,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
    );
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

describe('BankingDialog player loans', () => {
  const rules = { ...defaultGameRules, playerLoans: true };
  const loan: Loan = {
    id: 'ln1',
    gameId: 'g1',
    lenderKind: 'PLAYER',
    lenderPlayerId: 'p2',
    borrowerPlayerId: 'p1',
    principal: 500,
    repaidAmount: 100,
    state: 'ACTIVE',
    createdAt: '',
    closedAt: null,
  };

  it('hides the loan actions unless the rule is on', () => {
    renderDialog([olena, taras], { loans: [loan] });
    expect(screen.queryByRole('button', { name: 'Borrow from a player' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Repay a loan' })).toBeNull();
  });

  it('asks a lender for a loan as a request they must accept', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ paymentRequests: [], players: [] } as never);
    const { user, props } = renderDialog([olena, taras], { rules });

    await user.click(screen.getByRole('button', { name: 'Borrow from a player' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await press(user, '2', '5', '0');
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    expect(screen.getByText(/Taras must accept it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'LOAN_ISSUE', borrowerPlayerId: 'p1', lenderPlayerId: 'p2', amount: 250 },
      expect.any(String),
    );
    expect(props.onPaymentRequested).toHaveBeenCalledWith('LOAN_ISSUE', 'Taras');
    createTransaction.mockRestore();
  });

  it('repays part of a loan and refuses more than is owed', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 150 },
      players: [],
      loans: [],
    } as never);
    const { user, props } = renderDialog([olena, taras], { rules, loans: [loan] });

    await user.click(screen.getByRole('button', { name: 'Repay a loan' }));
    await user.click(screen.getByRole('button', { name: /Taras/ }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('400');

    await press(user, '1');
    expect(screen.getByText(/cannot repay more than/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();

    await press(user, 'Backspace', 'Backspace', 'Backspace', 'Backspace', '1', '5', '0');
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'LOAN_REPAYMENT', playerId: 'p1', loanId: 'ln1', amount: 150 },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'LOAN_REPAYMENT',
      150,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
    );
    createTransaction.mockRestore();
  });
});

describe('BankingDialog bank loans', () => {
  const rules = { ...defaultGameRules, bankLoans: true };
  const settings = { ...buildGameSettings(1_500_000), bankLoanMax: 1_000 };
  const bankLoan: Loan = {
    id: 'bl1',
    gameId: 'g1',
    lenderKind: 'BANK',
    lenderPlayerId: null,
    borrowerPlayerId: 'p1',
    principal: 400,
    repaidAmount: 0,
    state: 'ACTIVE',
    createdAt: '',
    closedAt: null,
    rounds: { round: 2, suggestedRatePercent: 10, overdue: false },
  };

  async function borrow250(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Borrow from the bank' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await press(user, '2', '5', '0');
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
  }

  it('hides the bank loan unless the rule is on', () => {
    renderDialog([olena, taras], { settings });
    expect(screen.queryByRole('button', { name: 'Borrow from the bank' })).toBeNull();
  });

  it('borrows from the bank at once, without naming a lender', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 250 },
      players: [],
      loans: [],
      bankLoanCooldowns: [],
    } as never);
    const { user, props } = renderDialog([olena, taras], { rules, settings });

    expect(screen.queryByRole('button', { name: 'Borrow from a player' })).toBeNull();
    await borrow250(user);
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId: 'p1', amount: 250 },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'BANK_LOAN',
      250,
      undefined,
      [],
      [],
      undefined,
      undefined,
    );
    createTransaction.mockRestore();
  });

  it('refuses more than the bank lends', async () => {
    const { user } = renderDialog([olena, taras], { rules, settings });
    await user.click(screen.getByRole('button', { name: 'Borrow from the bank' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(screen.getByText(/You can borrow up to .*1.000.* from the bank/)).toBeInTheDocument();
    await press(user, '2', '0', '0', '0');
    expect(screen.getByText(/The bank lends at most/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
  });

  it('blocks borrowing while a bank loan is still active', async () => {
    const { user } = renderDialog([olena, taras], { rules, settings, loans: [bankLoan] });
    await user.click(screen.getByRole('button', { name: 'Borrow from the bank' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    expect(screen.getByText(/already have a bank loan/)).toBeInTheDocument();
    await press(user, '5', '0');
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
  });

  it('warns during the cooldown and sends the acknowledgement once confirmed', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 250 },
      players: [],
    } as never);
    const { user } = renderDialog([olena, taras], {
      rules,
      settings,
      bankLoanCooldowns: [{ playerId: 'p1', roundsLeft: 1 }],
    });
    await borrow250(user);
    expect(screen.getByText(/rounds left: 1/)).toBeInTheDocument();
    expect(createTransaction).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Borrow anyway' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      {
        type: 'LOAN_ISSUE',
        lenderKind: 'BANK',
        playerId: 'p1',
        amount: 250,
        acknowledgeCooldown: true,
      },
      expect.any(String),
    );
    createTransaction.mockRestore();
  });

  it('shows the cooldown warning when the Worker reports one the client did not know', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockRejectedValue(
      new MonopolyBankApiError({
        code: 'BANK_LOAN_COOLDOWN',
        message: 'cooldown',
        details: { roundsLeft: 2 },
      }),
    );
    const { user } = renderDialog([olena, taras], { rules, settings });
    await borrow250(user);
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(await screen.findByText(/rounds left: 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Borrow anyway' })).toBeInTheDocument();
    createTransaction.mockRestore();
  });

  it('repays a bank loan in full with the suggested rate preselected', async () => {
    const createTransaction = vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 440 },
      players: [],
      loans: [],
      bankLoanCooldowns: [{ playerId: 'p1', roundsLeft: 2 }],
    } as never);
    const { user, props } = renderDialog([olena, taras], { rules, settings, loans: [bankLoan] });

    await user.click(screen.getByRole('button', { name: 'Repay a loan' }));
    await user.click(screen.getByRole('button', { name: /Bank · .*400.* still owed · round 2/ }));
    expect(screen.queryByRole('textbox', { name: 'Amount' })).toBeNull();
    expect(screen.getByRole('button', { name: '10% · suggested (round 2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/400 plus .*40 interest, .*440 in total/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '20%' }));
    expect(screen.getByText(/400 plus .*80 interest, .*480 in total/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '10% · suggested (round 2)' }));
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    expect(screen.getByText('Interest')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));

    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      {
        type: 'LOAN_REPAYMENT',
        playerId: 'p1',
        loanId: 'bl1',
        amount: 400,
        interestRatePercent: 10,
      },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'LOAN_REPAYMENT',
      440,
      undefined,
      [],
      [{ playerId: 'p1', roundsLeft: 2 }],
      undefined,
      undefined,
    );
    createTransaction.mockRestore();
  });

  it('offers the way out when an overdue bank loan cannot be paid', async () => {
    const overdue: Loan = {
      ...bankLoan,
      principal: 2_000_000,
      borrowerPlayerId: 'p2',
      rounds: { round: 4, suggestedRatePercent: 20, overdue: true },
    };
    const { user, props } = renderDialog([olena, taras], {
      rules,
      settings,
      player: taras,
      loans: [overdue],
    });

    expect(screen.getByText(/is overdue \(round 4\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settle loan' }));
    expect(screen.getByText(/Short by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mortgage property' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell buildings to the bank' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Declare bankrupt' })[0]!);
    expect(props.onBankrupt).toHaveBeenCalled();
  });

  it('opens straight on the bank loan repayment when asked to settle it', () => {
    renderDialog([olena, taras], { rules, settings, loans: [bankLoan], settleOnOpen: true });
    expect(screen.getByText(/400 plus .*40 interest/)).toBeInTheDocument();
  });
});

describe('BankingDialog Free Parking jackpot', () => {
  const settings = buildGameSettings(15_000_000);
  const rules = { ...defaultGameRules, freeParkingJackpot: true };

  function mockCreate() {
    return vi.spyOn(monopolyBankApi, 'createTransaction').mockResolvedValue({
      transaction: { amount: 1_000_000 },
      players: [],
      jackpot: 1_000_000,
    } as never);
  }

  it('sends a tax chip to the pot and says so in the review', async () => {
    const createTransaction = mockCreate();
    const { user, props } = renderDialog([olena, taras], { rules, settings });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: /Luxury tax/ }));
    expect(screen.getAllByText(/Free Parking pot/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'TO_JACKPOT', playerId: 'p1', amount: 1_000_000, comment: 'Luxury tax' },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'PLAYER_TO_BANK',
      1_000_000,
      undefined,
      undefined,
      undefined,
      1_000_000,
      undefined,
    );
    createTransaction.mockRestore();
  });

  it('keeps the jail fine and a typed amount as payments to the bank', async () => {
    const createTransaction = mockCreate();
    const { user } = renderDialog([olena, taras], { rules, settings });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: /Jail fine/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction.mock.calls[0]?.[1]).toEqual({
      type: 'PLAYER_TO_BANK',
      playerId: 'p1',
      amount: 500_000,
      comment: 'Jail fine',
    });
    createTransaction.mockRestore();
  });

  it('pays a chip amount that was then edited by hand to the bank', async () => {
    const createTransaction = mockCreate();
    const { user } = renderDialog([olena, taras], { player: taras, rules, settings });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    // Too expensive to review, so the form stays open with the pot payment selected.
    await user.click(screen.getByRole('button', { name: /Income tax/ }));
    expect(screen.getByText(/goes into the Free Parking pot/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await press(user, '5');
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction.mock.calls[0]?.[1]).toMatchObject({
      type: 'PLAYER_TO_BANK',
      amount: 5,
    });
    createTransaction.mockRestore();
  });

  it('collects the whole pot from a confirmation that shows what is received', async () => {
    const createTransaction = mockCreate();
    const { user } = renderDialog([olena, taras], { rules, settings, jackpot: 3_000_000 });
    expect(screen.getByText('The Free Parking pot holds $3 000 000.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collect Free Parking' }));
    expect(screen.getAllByText('$3 000 000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$8 000 000').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction.mock.calls[0]?.[1]).toEqual({
      type: 'JACKPOT_PAYOUT',
      playerId: 'p1',
      expectedAmount: 3_000_000,
    });
    createTransaction.mockRestore();
  });

  it('hides the collection when the pot is empty', () => {
    renderDialog([olena, taras], { rules, settings, jackpot: 0 });
    expect(screen.queryByRole('button', { name: 'Collect Free Parking' })).toBeNull();
  });

  it('hides the jackpot action without the rule', () => {
    renderDialog([olena, taras], { settings, jackpot: 3_000_000 });
    expect(screen.queryByRole('button', { name: 'Collect Free Parking' })).toBeNull();
  });
});

describe('BankingDialog auctions', () => {
  const rules = { ...defaultGameRules, auctions: true };
  const auction: Auction = {
    id: 'a1',
    gameId: 'g1',
    lotName: 'Park Place',
    initiatorPlayerId: 'p2',
    state: 'ACTIVE',
    currentBid: 4_500_000,
    currentBidderId: 'p1',
    version: 3,
    startedAt: '2026-10-16T12:00:00.000Z',
    endsAt: '2026-10-16T12:00:30.000Z',
    serverTime: '2026-10-16T12:00:10.000Z',
    settledTransactionId: null,
  };

  it('offers to put a property up for auction only with the rule on', async () => {
    const onStartAuction = vi.fn();
    const { user } = renderDialog([olena, taras], { rules, onStartAuction });
    await user.click(screen.getByRole('button', { name: 'Put up for auction' }));
    expect(onStartAuction).toHaveBeenCalledWith('');
  });

  it('hides the action without the rule', () => {
    renderDialog([olena, taras], { onStartAuction: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Put up for auction' })).toBeNull();
  });

  it('disables the action while an auction is running', () => {
    renderDialog([olena, taras], { rules, onStartAuction: vi.fn(), auction });
    expect(screen.getByRole('button', { name: 'Put up for auction' })).toBeDisabled();
  });

  it('counts the leading bid as reserved and reduces the available cash', async () => {
    const { user } = renderDialog([olena, taras], { rules, auction });
    expect(screen.getByText('$4 500 000 reserved for your leading bid')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '1000000');
    // Balance $5 000 000 minus the reserved $4 500 000 leaves $500 000.
    expect(screen.getByText('Short by $500 000.')).toBeInTheDocument();
  });

  it('offers to auction the property instead when the payer is short', async () => {
    const onStartAuction = vi.fn();
    const { user } = renderDialog([olena, taras], {
      rules,
      player: taras,
      onStartAuction,
    });
    await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
    await user.click(screen.getByRole('button', { name: 'Whole units' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '1500000');
    await user.click(screen.getByRole('button', { name: /Add a comment/ }));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Boardwalk');
    await user.click(screen.getByRole('button', { name: 'Auction it instead' }));
    expect(onStartAuction).toHaveBeenCalledWith('Boardwalk');
  });
});

describe('BankingDialog board mode', () => {
  const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
  const settings = { ...buildGameSettings(15_000_000), board };
  const tile = (id: string) => board.tiles.find((candidate) => candidate.id === id)!;
  const row = (tileId: string, over: Partial<GameProperty> = {}): GameProperty => ({
    gameId: 'g1',
    tileId,
    ownerPlayerId: 'p1',
    mortgaged: false,
    houses: 0,
    ...over,
  });
  const boardProps = (properties: GameProperty[], extra: Partial<BankingDialogProps> = {}) => ({
    settings,
    properties,
    ...extra,
  });
  const tileButton = (id: string) =>
    screen.queryByRole('button', { name: new RegExp(tile(id).name) });

  it('buys an unowned tile from a list of free tiles and reviews price and resulting balance', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ transaction: { amount: 1 }, players: [] } as never);
    const { user, props } = renderDialog(
      [olena, taras],
      boardProps([row('zhitna'), row('nagatinska', { ownerPlayerId: 'p2' })]),
    );
    await user.click(screen.getByRole('button', { name: 'Buy property' }));
    expect(screen.queryByRole('textbox', { name: 'Amount' })).toBeNull();
    expect(tileButton('zhitna')).toBeNull();
    expect(tileButton('nagatinska')).toBeNull();
    await user.click(tileButton('ogarova')!);
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    expect(screen.getByText(tile('ogarova').name)).toBeInTheDocument();
    expect(screen.getByText('Resulting available balance')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'PROPERTY_PURCHASE', playerId: 'p1', tileId: 'ogarova' },
      expect.any(String),
    );
    expect(props.onCompleted).toHaveBeenCalledWith(
      [],
      'PROPERTY_PURCHASE',
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    createTransaction.mockRestore();
  });

  it('lists only own unmortgaged tiles without buildings in the group and hides the free-text name', async () => {
    const { user } = renderDialog(
      [olena, taras],
      boardProps([
        row('zhitna'),
        row('nagatinska', { houses: 1 }),
        row('ogarova', { mortgaged: true }),
        row('polyanka', { ownerPlayerId: 'p2' }),
        row('tverska'),
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'Mortgage property' }));
    expect(screen.queryByRole('textbox', { name: 'Property name' })).toBeNull();
    // The brown group has a building; a mortgaged tile and a tile of another player are not offered.
    expect(tileButton('zhitna')).toBeNull();
    expect(tileButton('ogarova')).toBeNull();
    expect(tileButton('polyanka')).toBeNull();
    expect(tileButton('tverska')).toBeInTheDocument();
  });

  it('mortgages a chosen tile at the card value without a typed amount', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ transaction: { amount: 1 }, players: [] } as never);
    const { user } = renderDialog([olena, taras], boardProps([row('zhitna')]));
    await user.click(screen.getByRole('button', { name: 'Mortgage property' }));
    await user.click(tileButton('zhitna')!);
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'MORTGAGE', playerId: 'p1', tileId: 'zhitna' },
      expect.any(String),
    );
    createTransaction.mockRestore();
  });

  it('redeems an active tile mortgage picked from the tile list', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ transaction: { amount: 1 }, players: [] } as never);
    const mortgage = {
      id: 'm1',
      gameId: 'g1',
      playerId: 'p1',
      propertyName: tile('zhitna').name,
      tileId: 'zhitna',
      mortgageValue: tile('zhitna').mortgage,
      createdAt: '',
    };
    const { user } = renderDialog(
      [olena, taras],
      boardProps([row('zhitna', { mortgaged: true })], { mortgages: [mortgage] }),
    );
    await user.click(screen.getByRole('button', { name: 'Redeem mortgage' }));
    await user.click(tileButton('zhitna')!);
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'MORTGAGE_REDEMPTION', playerId: 'p1', mortgageId: 'm1' },
      expect.any(String),
    );
    createTransaction.mockRestore();
  });

  it('previews street rent read-only and offers no mortgaged or own tiles', async () => {
    const { user } = renderDialog(
      [olena, taras],
      boardProps([
        row('zhitna', { ownerPlayerId: 'p2' }),
        row('nagatinska', { ownerPlayerId: 'p2', mortgaged: true }),
        row('ogarova'),
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'Pay rent' }));
    expect(tileButton('nagatinska')).toBeNull();
    expect(tileButton('ogarova')).toBeNull();
    await user.click(tileButton('zhitna')!);
    expect(screen.queryByRole('textbox', { name: 'Amount' })).toBeNull();
    expect(screen.getByText('Rent to pay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeEnabled();
  });

  it('asks for the dice total on a utility and sends it with the rent payment', async () => {
    const createTransaction = vi
      .spyOn(monopolyBankApi, 'createTransaction')
      .mockResolvedValue({ transaction: { amount: 1 }, players: [] } as never);
    const { user } = renderDialog(
      [olena, taras],
      boardProps([row('power_plant', { ownerPlayerId: 'p2' })]),
    );
    await user.click(screen.getByRole('button', { name: 'Pay rent' }));
    await user.click(tileButton('power_plant')!);
    const dice = () => screen.getByRole('textbox', { name: 'Dice total (2-12)' });
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
    await user.type(dice(), '13');
    expect(screen.getByText('Enter the dice total, a number from 2 to 12.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeDisabled();
    await user.clear(dice());
    await user.type(dice(), '7');
    await user.click(screen.getByRole('button', { name: 'Review transaction' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transaction' }));
    expect(createTransaction).toHaveBeenCalledWith(
      'g1',
      { type: 'PAY_RENT', payerPlayerId: 'p1', tileId: 'power_plant', diceSum: 7 },
      expect.any(String),
    );
    createTransaction.mockRestore();
  });

  it('opens straight on the quick-entry action with the tile preselected', () => {
    renderDialog(
      [olena, taras],
      boardProps([], { initialAction: 'PROPERTY_PURCHASE', initialTileId: 'zhitna' }),
    );
    expect(tileButton('zhitna')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeEnabled();
  });

  it('keeps the manual name and amount flows when the game has no board', async () => {
    const { user } = renderDialog([olena, taras]);
    expect(screen.queryByRole('button', { name: 'Buy property' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay rent' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mortgage property' }));
    expect(screen.getByRole('textbox', { name: 'Property name' })).toBeInTheDocument();
  });
});
